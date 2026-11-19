/**
 * Tests for the model path and the private HTTP bridge.
 *
 * These run without a Harness process: `ctx.llm` is a fake async generator and
 * the bridge handler is driven with plain request/response doubles. They pin:
 *   - route resolution (config → profile default → none),
 *   - prompt construction (language, placeholders, no invented facts),
 *   - stream assembly, provider failures, timeouts,
 *   - the endpoint's method / origin / content-type / size / concurrency guards,
 *   - request→rewrite→response shape used by the composer button.
 *
 * Run: node --test test/llm.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveRoute,
  buildSystemPrompt,
  buildMessages,
  cleanModelOutput,
  callModel,
  rewriteWithModel,
  LLM_ERRORS,
} from '../lib/llm.js'
import { createBridgeHandler, isSameOrigin, BRIDGE_MAX_BODY } from '../lib/bridge.js'

/** A ctx.llm double whose stream yields the given chunks. */
function fakeLlm(chunks, { capture } = {}) {
  return {
    stream(options) {
      if (capture) capture.push(options)
      return (async function* stream() {
        for (const chunk of chunks) yield chunk
      })()
    },
  }
}

/** ctx.llm whose stream never yields until its signal aborts. */
function hangingLlm() {
  return {
    stream(options) {
      return (async function* stream() {
        await new Promise((_resolve, reject) => {
          const signal = options.signal
          if (!signal) return
          const abort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        })
      })()
    },
  }
}

function makeReq({ method = 'POST', headers = {}, body = '' } = {}) {
  const listeners = new Map()
  return {
    method,
    headers,
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(callback)
      return this
    },
    removeListener(event, callback) {
      const list = listeners.get(event)
      if (list) listeners.set(event, list.filter((cb) => cb !== callback))
      return this
    },
    emit(event, value) {
      for (const callback of listeners.get(event) ?? []) callback(value)
    },
    async run() {
      if (body) this.emit('data', Buffer.from(body, 'utf8'))
      this.emit('end')
    },
  }
}

function makeRes() {
  const state = { status: 0, headers: {}, body: '' }
  return {
    get status() { return state.status },
    get headers() { return state.headers },
    get body() { return state.body },
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers) {
      state.status = status
      state.headers = headers ?? {}
      this.headersSent = true
    },
    end(chunk) {
      state.body = String(chunk ?? '')
      this.writableEnded = true
    },
    destroy() {},
  }
}

async function callBridge(handler, options) {
  const req = makeReq(options)
  const res = makeRes()
  const done = handler(req, res)
  await req.run()
  await done
  return res
}

const enhanceOk = async ({ text }) => ({
  enhanced: `帮我写一份${text}，用 Markdown，约 400 字，先列三件最重要的事，缺信息就问我。`,
  provider: 'magpie',
  model: 'ollama/deepseek-v4.1-flash',
  routeSource: 'default',
})

test('resolveRoute prefers config, then the profile default, then none', () => {
  assert.deepEqual(resolveRoute({}, { provider: 'p', model: 'm' }), { provider: 'p', model: 'm', source: 'config' })
  const ctx = { agentDefaultModel: { currentSelection: () => ({ provider: 'magpie', model: 'x' }) } }
  assert.deepEqual(resolveRoute(ctx, {}), { provider: 'magpie', model: 'x', source: 'default' })
  assert.equal(resolveRoute({}, {}), undefined)
  assert.equal(resolveRoute({ agentDefaultModel: { currentSelection: () => undefined } }, { provider: 'p' }), undefined)
})

test('system prompt asks for the prompt itself, never a template document', () => {
  const zh = buildSystemPrompt({ language: 'zh' })
  assert.match(zh, /只输出改写后的提示词正文/)
  assert.match(zh, /不要标题/)
  assert.match(zh, /约 200–300 字/)
  assert.match(zh, /第一人称/)
  assert.ok(!zh.includes('## 任务拆解'), 'no section scaffolding')
  assert.match(zh, /不要写"（待补充）\/TBD"之类的占位符/, 'placeholders are forbidden, not requested')
  assert.ok(zh.includes('不要"原始请求"引用'), 'forbids quoting the original request')
  assert.ok(zh.includes('简体中文'), 'asks for Simplified Chinese output')

  const en = buildSystemPrompt({ language: 'en' })
  assert.match(en, /Output ONLY the rewritten prompt text/)
  assert.match(en, /no section headings/)
  assert.match(en, /about 150 words/)
  assert.match(en, /Do not answer the request/)
  assert.ok(!en.includes('## Task breakdown'))
})

test('messages carry the raw request and only caller-supplied facts', () => {
  const messages = buildMessages({
    text: '帮我写个周报',
    language: 'zh',
    context: { date: '2026-11-18', workspace: 'default-workspace' },
  })
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, 'user')
  assert.equal(messages[0].content[0].type, 'text')
  const text = messages[0].content[0].text
  assert.ok(text.includes('帮我写个周报'))
  assert.ok(text.includes('one prompt I can send right away'))
  assert.ok(text.includes('date: 2026-11-18'))
  assert.ok(text.includes('workspace: default-workspace'))

  const bare = buildMessages({ text: 'x', language: 'en', includeOriginal: true, context: {} })
  assert.ok(!bare[0].content[0].text.includes('Known context'))
})

test('cleanModelOutput strips fences and preambles only', () => {
  assert.equal(cleanModelOutput('```markdown\n## 角色\nx\n```'), '## 角色\nx')
  assert.equal(cleanModelOutput('Here is the enhanced prompt:\n\n## 角色\nx'), '## 角色\nx')
  assert.equal(cleanModelOutput('  ## 角色\nx  '), '## 角色\nx')
})

test('callModel joins text deltas and forwards provider failures', async () => {
  const capture = []
  const ctx = { llm: fakeLlm([
    { type: 'text-delta', index: 0, text: '## 角色\n' },
    { type: 'text-delta', index: 1, text: '内容编辑' },
    { type: 'finish', kind: 'stop' },
  ], { capture }) }
  const result = await callModel(ctx, { provider: 'p', model: 'm' }, {
    system: 'sys',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    maxTokens: 100,
    timeoutMs: 5000,
  })
  assert.equal(result.text, '## 角色\n内容编辑')
  assert.equal(result.finish.kind, 'stop')
  assert.equal(capture[0].provider, 'p')
  assert.equal(capture[0].system, 'sys')
  assert.equal(capture[0].maxTokens, 100)
  assert.ok(capture[0].signal, 'an abort signal is always passed')

  const failing = { llm: fakeLlm([{ type: 'finish', kind: 'error', failure: { code: 'X', message: 'quota exceeded' } }]) }
  await assert.rejects(
    () => callModel(failing, { provider: 'p', model: 'm' }, { system: 's', messages: [], timeoutMs: 1000 }),
    (error) => error.code === LLM_ERRORS.PROVIDER && /quota exceeded/.test(error.message),
  )
})

test('callModel times out through its own deadline', async () => {
  const ctx = { llm: hangingLlm() }
  await assert.rejects(
    () => callModel(ctx, { provider: 'p', model: 'm' }, { system: 's', messages: [], timeoutMs: 25 }),
    (error) => error.code === LLM_ERRORS.TIMEOUT,
  )
})

test('rewriteWithModel resolves the profile default and cleans the output', async () => {
  const ctx = {
    llm: fakeLlm([
      { type: 'text-delta', text: '```markdown\n优化后的提示词：帮我写一份本周工作周报，Markdown 格式，约 400 字，先列三件最重要的事。\n```' },
      { type: 'finish', kind: 'stop' },
    ]),
    agentDefaultModel: { currentSelection: () => ({ provider: 'magpie', model: 'ollama/deepseek-v4.1-flash' }) },
  }
  const result = await rewriteWithModel(ctx, { maxOutputTokens: 500, timeoutMs: 5000 }, {
    text: '帮我写个周报',
    language: 'auto',
    context: { date: '2026-11-18' },
  })
  assert.equal(result.provider, 'magpie')
  assert.equal(result.routeSource, 'default')
  assert.equal(result.language, 'zh')
  assert.ok(result.enhanced.startsWith('帮我写一份本周工作周报'))
  assert.ok(!result.enhanced.startsWith('```'))
  assert.ok(!result.enhanced.includes('##'), 'no document headings')
  assert.ok(!result.enhanced.includes('待补充'), 'no placeholders')

  await assert.rejects(
    () => rewriteWithModel({ llm: ctx.llm }, {}, { text: 'x' }),
    (error) => error.code === LLM_ERRORS.NO_ROUTE,
  )
})

test('same-origin guard accepts absent Origin and rejects a foreign one', () => {
  assert.equal(isSameOrigin({ host: '127.0.0.1:54248' }), true)
  assert.equal(isSameOrigin({ host: '127.0.0.1:54248', origin: 'http://127.0.0.1:54248' }), true)
  assert.equal(isSameOrigin({ host: '127.0.0.1:54248', origin: 'http://evil.example' }), false)
  assert.equal(isSameOrigin({ host: '127.0.0.1:54248', origin: 'not a url' }), false)
})

test('bridge rejects wrong method, content type and cross-origin calls', async () => {
  const handler = createBridgeHandler({
    version: '1.2.0',
    strategy: 'llm',
    describeRoute: () => ({ provider: 'p', model: 'm', source: 'default' }),
    enhance: enhanceOk,
  })

  assert.equal((await callBridge(handler, { method: 'GET' })).status, 405)
  assert.equal((await callBridge(handler, { headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await callBridge(handler, {
    headers: { 'content-type': 'application/json', host: '127.0.0.1:1', origin: 'http://evil.example' },
  })).status, 403)
})

test('bridge validates the body and caps its size', async () => {
  const handler = createBridgeHandler({
    version: '1.2.0',
    strategy: 'llm',
    describeRoute: () => undefined,
    enhance: enhanceOk,
  })
  const headers = { 'content-type': 'application/json' }

  assert.equal((await callBridge(handler, { headers, body: '{oops' })).status, 400)
  assert.equal((await callBridge(handler, { headers, body: '[]' })).status, 400)
  assert.equal((await callBridge(handler, { headers, body: '{"op":"nope"}' })).status, 404)
  assert.equal((await callBridge(handler, { headers, body: '{"op":"enhance","text":"   "}' })).status, 400)

  const oversized = 'x'.repeat(BRIDGE_MAX_BODY + 10)
  const tooBig = await callBridge(handler, { headers, body: `{"op":"enhance","text":"${oversized}"}` })
  assert.equal(tooBig.status, 413)
})

test('bridge answers ping and enhance with the documented shape', async () => {
  const handler = createBridgeHandler({
    version: '1.2.0',
    strategy: 'llm',
    describeRoute: () => ({ provider: 'magpie', model: 'm', source: 'default' }),
    enhance: enhanceOk,
  })
  const headers = { 'content-type': 'application/json' }

  const ping = await callBridge(handler, { headers, body: '{"op":"ping"}' })
  assert.equal(ping.status, 200)
  const pingBody = JSON.parse(ping.body)
  assert.deepEqual(pingBody, {
    ok: true,
    version: '1.2.0',
    strategy: 'llm',
    route: { provider: 'magpie', model: 'm', source: 'default' },
  })

  const enhance = await callBridge(handler, {
    headers,
    body: JSON.stringify({ op: 'enhance', text: '帮我写个周报', sessionId: 's1' }),
  })
  assert.equal(enhance.status, 200)
  const body = JSON.parse(enhance.body)
  assert.equal(body.ok, true)
  assert.ok(body.enhanced.includes('帮我写个周报'))
  assert.equal(body.meta.provider, 'magpie')
  assert.equal(body.meta.model, 'ollama/deepseek-v4.1-flash')
  assert.equal(typeof body.meta.elapsedMs, 'number')
  assert.equal(enhance.headers['cache-control'], 'no-store')
})

test('settings ops expose effective defaults and normalize saved values', async () => {
  let stored = {}
  const handler = createBridgeHandler({
    version: '1.3.1',
    strategy: 'llm',
    describeRoute: () => undefined,
    enhance: enhanceOk,
    getSettings: () => stored,
    describeSettings: () => ({
      strategy: 'llm',
      style: 'natural',
      length: 'normal',
      language: 'auto',
      includeHistory: true,
      historyMessages: 6,
      historyChars: 2000,
      extraInstruction: '',
      llm: { provider: '', model: '', maxOutputTokens: 1400, temperature: 0.2, timeoutMs: 45000 },
    }),
    saveSettings: (next) => {
      stored = { ...stored, ...next }
      return stored
    },
  })
  const headers = { 'content-type': 'application/json' }

  const read = await callBridge(handler, { headers, body: '{"op":"settings"}' })
  assert.equal(read.status, 200)
  const readBody = JSON.parse(read.body)
  assert.equal(readBody.settings.includeHistory, true, 'context is on by default')
  assert.equal(readBody.settings.historyMessages, 6)
  assert.equal(readBody.settings.length, 'normal')

  const save = await callBridge(handler, {
    headers,
    body: JSON.stringify({ op: 'saveSettings', settings: { length: 'short' } }),
  })
  assert.equal(save.status, 200)
  assert.equal(JSON.parse(save.body).overrides.length, 'short')
  assert.equal(JSON.parse(save.body).settings.length, 'normal', 'effective view still reports the merged config')
})

test('bridge maps rewrite failures to statuses and blocks a second in-flight call', async () => {
  const handler = createBridgeHandler({
    version: '1.2.0',
    strategy: 'llm',
    describeRoute: () => undefined,
    enhance: async () => {
      const error = new Error('model exploded')
      error.code = 'provider-error'
      throw error
    },
  })
  const headers = { 'content-type': 'application/json' }
  const failed = await callBridge(handler, { headers, body: '{"op":"enhance","text":"x"}' })
  assert.equal(failed.status, 502)
  assert.equal(JSON.parse(failed.body).error.code, 'provider-error')

  let release
  const gate = new Promise((resolve) => { release = resolve })
  const busyHandler = createBridgeHandler({
    version: '1.2.0',
    strategy: 'llm',
    describeRoute: () => undefined,
    enhance: async () => {
      await gate
      return { enhanced: 'ok' }
    },
  })
  const first = callBridge(busyHandler, {
    headers,
    body: JSON.stringify({ op: 'enhance', text: 'x', sessionId: 's1' }),
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const second = await callBridge(busyHandler, {
    headers,
    body: JSON.stringify({ op: 'enhance', text: 'y', sessionId: 's1' }),
  })
  assert.equal(second.status, 429)
  release()
  assert.equal((await first).status, 200)
})
