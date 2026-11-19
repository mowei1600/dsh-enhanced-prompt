/**
 * Host-wiring tests for dsh-enhanced-prompt.
 *
 * These tests exercise `index.js` without a running DSH: a mock Cordis context
 * captures every registration, so manifest/patch drift, grammar regressions and
 * config-normalization bugs fail here instead of in a live profile.
 *
 * Run: node --test test/host.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import * as plugin from '../index.js'
import { PRESET_IDS } from '../lib/presets.js'

/** Config that exercises the offline engine (no model call, no ctx.llm). */
const ruleCfg = (overrides = {}) => plugin.normalizeConfig({ strategy: 'rule', ...overrides })

/** Capture registrations made through `ctx.inject(...)`. */
function makeCtx() {
  const calls = []
  const scope = {
    commands: {
      register: (definition) => calls.push({ kind: 'command', definition }),
    },
    tools: {
      register: (definition) => calls.push({ kind: 'tool', definition }),
    },
    systemPrompt: {
      section: (section) => calls.push({ kind: 'section', section }),
    },
    webServer: {
      register: (route) => {
        calls.push({ kind: 'route', route })
        return () => {}
      },
    },
    effect: (execute) => {
      const disposer = execute()
      return () => { if (typeof disposer === 'function') disposer() }
    },
  }
  const ctx = {
    inject: (deps, callback) => {
      calls.push({ kind: 'inject', deps })
      callback(scope)
      return { deps }
    },
  }
  return { ctx, calls }
}

/** Run `fn` while capturing console.log lines. */
function captureLog(fn) {
  const lines = []
  const original = console.log
  console.log = (...args) => lines.push(args.join(' '))
  try {
    fn()
  } finally {
    console.log = original
  }
  return lines
}

test('normalizeConfig fills every documented default', () => {
  const cfg = plugin.normalizeConfig(undefined)
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.preset, 'auto')
  assert.equal(cfg.language, 'auto')
  assert.equal(cfg.tone, 'standard')
  assert.equal(cfg.maxInputBytes, 8000)
  assert.equal(cfg.maxOutputBytes, 16000)
  assert.equal(cfg.includeOriginal, true)
  assert.equal(cfg.allowApply, true)
  assert.equal(cfg.command.name, 'enhance')
  assert.equal(cfg.tool.name, 'enhance_prompt')
  assert.equal(cfg.guidance.order, 5150)
  assert.equal(cfg.guidance.threshold, 45)
  assert.equal(cfg.context.includeDate, true)
})

test('normalizeConfig clamps numbers, rejects unknown enums, and keeps overrides', () => {
  const cfg = plugin.normalizeConfig({
    preset: 'nope',
    language: 'fr',
    tone: 'shouty',
    maxInputBytes: 5,
    maxOutputBytes: 10 ** 9,
    command: { name: 'ENHANCE' },
    tool: { name: 'my_enhancer' },
    guidance: { order: 5200, threshold: 0 },
    diagnostics: 'true',
  })
  assert.equal(cfg.preset, 'auto')
  assert.equal(cfg.language, 'auto')
  assert.equal(cfg.tone, 'standard')
  assert.equal(cfg.maxInputBytes, 256, 'clamped to the documented floor')
  assert.equal(cfg.maxOutputBytes, 60000, 'clamped to the documented ceiling')
  assert.equal(cfg.command.name, 'enhance', 'lower-cased command name')
  assert.equal(cfg.tool.name, 'my_enhancer')
  assert.equal(cfg.guidance.order, 5200)
  assert.equal(cfg.guidance.threshold, 1, 'threshold clamped into 1..100')
  assert.equal(cfg.diagnostics, true)
  assert.equal(cfg.context.includeCwd, true, 'nested defaults survive partial override')
})

test('parseCommandInput implements the documented grammar', () => {
  assert.deepEqual(plugin.parseCommandInput(''), { mode: 'help', text: '' })
  assert.equal(plugin.parseCommandInput('help').mode, 'help')
  assert.equal(plugin.parseCommandInput('？？').mode, 'help')
  assert.equal(plugin.parseCommandInput('status').mode, 'status')
  assert.equal(plugin.parseCommandInput('--status').mode, 'status')

  const apply = plugin.parseCommandInput('apply 帮我写个周报')
  assert.equal(apply.mode, 'apply')
  assert.equal(apply.text, '帮我写个周报')

  const preview = plugin.parseCommandInput('帮我写个周报')
  assert.equal(preview.mode, 'preview')
  assert.equal(preview.text, '帮我写个周报')

  const preset = plugin.parseCommandInput('preset code  优化这个函数')
  assert.equal(preset.mode, 'preview')
  assert.equal(preset.preset, 'code')
  assert.equal(preset.text, '优化这个函数')

  const lang = plugin.parseCommandInput('lang en write a weekly report')
  assert.equal(lang.language, 'en')
  assert.equal(lang.text, 'write a weekly report')

  assert.equal(plugin.parseCommandInput('preset nope hi').mode, 'error')
  assert.equal(plugin.parseCommandInput('lang fr hi').mode, 'error')
  assert.equal(plugin.parseCommandInput('preset code').mode, 'error', 'preset without text')
  assert.equal(plugin.parseCommandInput('apply').text, '')
})

test('command handler renders a preview without touching the agent', async () => {
  const cfg = ruleCfg()
  const command = plugin.createCommandDefinition(cfg)
  assert.equal(command.name, 'enhance')
  assert.ok(command.description.length > 10)
  assert.ok(command.input.hint.includes('apply'))

  const result = await command.handler({ rawInput: '帮我写个周报', agent: null })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.startsWith('# '))
  assert.ok(result.text.includes('（待补充）') || result.text.includes('目标'))
  assert.ok(result.text.includes('/enhance apply'), 'preview explains how to apply')
})

test('apply steers exactly one identified user message with the enhanced text', async () => {
  const cfg = ruleCfg()
  const command = plugin.createCommandDefinition(cfg)
  const steered = []
  const result = await command.handler({
    rawInput: 'apply 帮我写个周报',
    agent: { steer: async (message) => steered.push(message) },
  })
  assert.equal(result.kind, 'success')
  assert.equal(steered.length, 1)
  const message = steered[0]
  assert.equal(message.role, 'user', 'steer() takes a role-tagged UserMessage')
  assert.equal(typeof message.id, 'string')
  assert.match(message.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'message id is a UUID')
  assert.equal(message.content.length, 1)
  assert.equal(message.content[0].type, 'text')
  assert.ok(message.content[0].text.includes('目标') || message.content[0].text.includes('角色'))
  assert.equal(message.source.kind, 'enhanced-prompt')

  // Two pending applies must not collide in the inbox dedupe, which keys on message.id.
  const again = []
  const second = await command.handler({
    rawInput: 'apply 帮我写个周报',
    agent: { steer: async (m) => again.push(m) },
  })
  assert.equal(second.kind, 'success')
  assert.notEqual(again[0].id, message.id, 'each apply mints a fresh identity')
})

test('apply degrades safely: disabled, no agent, throwing agent, empty input', async () => {
  const noApply = ruleCfg({ allowApply: false })
  const previewOnly = await plugin.createCommandDefinition(noApply).handler({ rawInput: 'apply 写周报', agent: null })
  assert.equal(previewOnly.kind, 'success')
  assert.ok(previewOnly.text.includes('allowApply'))

  const withAgent = ruleCfg()
  const noAgent = await plugin.createCommandDefinition(withAgent).handler({ rawInput: 'apply 写周报', agent: null })
  assert.equal(noAgent.kind, 'error')

  const throwing = await plugin.createCommandDefinition(withAgent).handler({
    rawInput: 'apply 写周报',
    agent: { steer: async () => { throw new Error('agent disposed') } },
  })
  assert.equal(throwing.kind, 'error')
  assert.ok(throwing.text.includes('agent disposed'))

  const empty = await plugin.createCommandDefinition(withAgent).handler({ rawInput: 'apply', agent: null })
  assert.equal(empty.kind, 'error')
})

test('status and help commands answer in both languages', async () => {
  const cfg = ruleCfg()
  const command = plugin.createCommandDefinition(cfg)
  const status = await command.handler({ rawInput: 'status' })
  assert.equal(status.kind, 'success')
  assert.ok(status.text.includes('v' + plugin.VERSION))
  assert.ok(status.text.includes('/enhance'))
  assert.ok(status.text.includes('enhance_prompt'))

  const help = await command.handler({ rawInput: '' })
  assert.equal(help.kind, 'success')
  assert.ok(help.text.includes('/enhance'))
})

test('tool definition exposes a minimal JSON schema and executes the engine', async () => {
  const cfg = ruleCfg()
  const tool = plugin.createToolDefinition(cfg)
  assert.equal(tool.name, 'enhance_prompt')
  assert.equal(tool.parameters.type, 'object')
  assert.equal(tool.parameters.additionalProperties, false)
  assert.deepEqual(tool.parameters.required, ['prompt'])
  assert.ok(tool.parameters.properties.prompt)
  for (const key of Object.keys(tool.parameters.properties)) {
    assert.ok(['string', 'number'].includes(tool.parameters.properties[key].type), `${key} uses a supported wire type`)
  }
  assert.equal(tool.output.schema.type, 'object')
  assert.equal(tool.output.schema.additionalProperties, false)

  const ok = await tool.execute({ prompt: '做一个竞品分析', preset: 'concise', language: 'en' })
  assert.equal(ok.ok, true)
  assert.ok(ok.enhanced.length > 0)
  assert.equal(ok.error, '')
  const meta = JSON.parse(ok.meta)
  assert.equal(meta.preset, 'concise')
  assert.ok(meta.elapsedMs >= 0)

  const rendered = tool.output.render({}, ok)
  assert.equal(rendered.length, 1)
  assert.equal(rendered[0].type, 'text')
  assert.ok(rendered[0].text.includes('Enhanced prompt') || rendered[0].text.includes('增强提示词'))

  const empty = await tool.execute({ prompt: '   ' })
  assert.equal(empty.ok, false)
  const failureRender = tool.output.render({}, empty)
  assert.ok(failureRender[0].text.startsWith('Error:'))

  const replay = tool.output.render({}, undefined)
  assert.equal(replay[0].text, 'Error: enhancement failed')
})

test('tool ignores unsupported overrides instead of failing', async () => {
  const cfg = ruleCfg()
  const tool = plugin.createToolDefinition(cfg)
  const out = await tool.execute({
    prompt: '写一段产品文案',
    preset: 'nonexistent',
    language: 'de',
    tone: 'shouty',
  })
  assert.equal(out.ok, true)
  const meta = JSON.parse(out.meta)
  assert.ok(PRESET_IDS.includes(meta.preset))
  assert.ok(['zh', 'en'].includes(meta.language))
})

test('session working directory reaches the prompt and harness-internal paths never do', async () => {
  const cfg = ruleCfg()
  const workspace = process.platform === 'win32' ? 'C:\\work\\quarterly-report' : '/work/quarterly-report'

  const withWorkspace = plugin.createToolDefinition(cfg, {
    getWorkingDirectory: (agent) => (agent?.session?.id === 's1' ? workspace : undefined),
  })
  const ok = await withWorkspace.execute({ prompt: '写个周报' }, { agent: { session: { id: 's1' } } })
  assert.equal(ok.ok, true)
  assert.ok(ok.enhanced.includes('quarterly-report'), 'workspace name appears in the background section')

  const internal = plugin.createToolDefinition(cfg, {
    getWorkingDirectory: () => (process.platform === 'win32'
      ? 'C:\\Users\\someone\\.dsh\\profiles\\desktop'
      : '/home/someone/.dsh/profiles/desktop'),
  })
  const filtered = await internal.execute({ prompt: '写个周报' }, { agent: { session: { id: 's2' } } })
  assert.equal(filtered.ok, true)
  assert.ok(!filtered.enhanced.includes('.dsh'), 'profile path is filtered out of the prompt')
  assert.ok(!filtered.enhanced.includes('profiles'), 'profile directory is filtered out of the prompt')
})

test('tool failures use tool-facing copy, command failures use command copy', async () => {
  const cfg = ruleCfg()
  const tool = plugin.createToolDefinition(cfg, { getWorkingDirectory: () => undefined })
  const toolFailure = await tool.execute({ prompt: '   ' })
  assert.equal(toolFailure.ok, false)
  assert.ok(toolFailure.error.includes('prompt'), 'tool error names the prompt field')
  assert.ok(!toolFailure.error.toLowerCase().includes('command'), 'tool error never talks about slash commands')

  const commandFailure = await plugin.createCommandDefinition(cfg).handler({ rawInput: 'apply', agent: null })
  assert.equal(commandFailure.kind, 'error')
  assert.ok(commandFailure.text.includes('/enhance'), 'command empty-input copy points at the command')
})

test('apply registers command, tool and guidance section through ctx.inject', () => {
  const { ctx, calls } = makeCtx()
  captureLog(() => plugin.apply(ctx, { diagnostics: true }))
  const deps = calls.filter((c) => c.kind === 'inject').map((c) => c.deps)
  assert.deepEqual(deps, [['agentDefaultModel'], ['llm'], ['sessions'], ['commands'], ['tools'], ['systemPrompt'], ['webServer', 'llm']])
  assert.equal(calls.filter((c) => c.kind === 'command').length, 1)
  assert.equal(calls.filter((c) => c.kind === 'tool').length, 1)
  const sections = calls.filter((c) => c.kind === 'section')
  assert.equal(sections.length, 1)
  assert.equal(sections[0].section.name, 'enhanced-prompt:guidance')
  assert.equal(sections[0].section.order, 5150)
  assert.equal(sections[0].section.interpolate, false)
  const text = sections[0].section.text()
  assert.ok(text.includes('enhance_prompt'))
  assert.ok(text.includes('placeholder'))
})

test('disabled config registers nothing and logs the reason', () => {
  const { ctx, calls } = makeCtx()
  const lines = captureLog(() => plugin.apply(ctx, { enabled: false, diagnostics: true }))
  assert.equal(calls.length, 0)
  assert.ok(lines.some((line) => line.includes('disabled by config')))
})

test('capability toggles and custom names are honored', () => {
  const { ctx, calls } = makeCtx()
  captureLog(() => plugin.apply(ctx, {
    command: { enabled: false },
    tool: { enabled: true, name: 'wb_enhance' },
    guidance: { enabled: false },
    diagnostics: false,
  }))
  assert.deepEqual(calls.filter((c) => c.kind === 'inject').map((c) => c.deps), [['agentDefaultModel'], ['llm'], ['sessions'], ['tools'], ['webServer', 'llm']])
  const tools = calls.filter((c) => c.kind === 'tool')
  assert.equal(tools.length, 1)
  assert.equal(tools[0].definition.name, 'wb_enhance')
})

test('registration failures are logged, not thrown', () => {
  const scope = {
    tools: { register: () => { throw new Error('duplicate tool') } },
    commands: { register: () => { throw new Error('duplicate command') } },
    systemPrompt: { section: () => { throw new Error('duplicate section') } },
    webServer: { register: () => { throw new Error('duplicate route') } },
    effect: (execute) => execute(),
  }
  const ctx = { inject: (_deps, callback) => callback(scope) }
  const lines = captureLog(() => plugin.apply(ctx, { diagnostics: true }))
  assert.equal(lines.filter((line) => line.includes('registration failed')).length, 4)
})

test('guidance text adapts to custom tool name and threshold', () => {
  const cfg = plugin.normalizeConfig({ tool: { name: 'restate_it' }, guidance: { threshold: 30 } })
  const text = plugin.guidanceText(cfg)
  assert.ok(text.includes('`restate_it`'))
  assert.ok(text.includes('30/100'))
  assert.ok(text.includes('/enhance'))
})

test('invalid command/tool names fall back with warnings instead of failing registration', () => {
  const { config, warnings } = plugin.normalizeConfigResult({
    command: { name: 'Bad Name!' },
    tool: { name: 'has space' },
  })
  assert.equal(config.command.name, 'enhance')
  assert.equal(config.tool.name, 'enhance_prompt')
  assert.equal(warnings.length, 2)
  assert.ok(warnings[0].includes('invalid command name'))
  assert.ok(warnings[1].includes('invalid tool name'))

  const ok = plugin.normalizeConfigResult({ command: { name: 'enhance-2' }, tool: { name: 'enhance_prompt.v2' } })
  assert.equal(ok.config.command.name, 'enhance-2')
  assert.equal(ok.config.tool.name, 'enhance_prompt.v2')
  assert.equal(ok.warnings.length, 0)

  const lines = captureLog(() => plugin.apply(makeCtx().ctx, { command: { name: 'bad name' }, diagnostics: true }))
  assert.ok(lines.some((line) => line.includes('configWarnings')), 'activation log reports config warnings')
})

test('no working directory service means no cwd fact at all (no process.cwd fallback)', async () => {
  const cfg = ruleCfg()
  const tool = plugin.createToolDefinition(cfg)
  const out = await tool.execute({ prompt: '写个周报' })
  assert.equal(out.ok, true)
  const cwd = process.cwd()
  assert.ok(!out.enhanced.includes(cwd), 'process cwd must not leak when the Host service is absent')
  assert.ok(!out.enhanced.includes('默认工作目录'), 'no fabricated working directory')
})

test('renderPreview localizes warning codes and keeps the enhanced prompt first', () => {
  const cfg = ruleCfg()
  const result = {
    ok: true,
    original: '帮我写个周报',
    enhanced: '## 目标\n写周报',
    sections: [],
    meta: { preset: 'goal-oriented', language: 'zh', originalChars: 6, specificityBefore: 14, specificityAfter: 90, truncated: false },
    warnings: ['facts-marked-unknown', 'input-truncated', 'made-up-code'],
  }
  const text = plugin.renderPreview(result, cfg)
  assert.ok(text.startsWith('# 增强提示词'), 'preview title outranks its h2 sections')
  assert.ok(text.includes(`v${plugin.VERSION}`), 'preview names the running plugin version')
  assert.ok(text.includes('注意：'))
  assert.ok(text.includes('待补充'))
  assert.ok(text.includes('made-up-code'), 'unknown codes pass through')
  assert.ok(text.indexOf('## 目标') < text.indexOf('注意'), 'enhanced prompt precedes metadata')
  assert.ok(text.includes('/enhance apply'), 'command surface advertises the apply subcommand')

  const toolText = plugin.renderPreview(result, cfg, 'tool')
  assert.ok(!toolText.includes('/enhance apply'), 'tool surface does not advertise a slash command')
  assert.ok(toolText.includes('原始请求已保留'), 'tool surface keeps the model-facing footer')

  const english = plugin.renderPreview(
    { ok: true, original: 'write a report', enhanced: '## Goal\nx', sections: [], meta: { preset: 'standard', language: 'en', originalChars: 14, specificityBefore: 10, specificityAfter: 80 }, warnings: ['facts-marked-unknown'] },
    cfg,
  )
  assert.ok(english.includes('Note: '), 'English warning label uses an ASCII colon')
  assert.ok(!english.includes('Note：'), 'no full-width colon in English output')
})

test('maxBytes is enforced, not clamped away', async () => {
  const cfg = ruleCfg()
  const tool = plugin.createToolDefinition(cfg)
  const tooLong = await tool.execute({ prompt: '这是一段明显超过十六字节的输入', maxBytes: 16 })
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.error, /requested maxBytes limit is 16/)

  const outOfRange = await tool.execute({ prompt: '写个周报', maxBytes: 1 })
  assert.equal(outOfRange.ok, false)
  assert.match(outOfRange.error, /supported range is 16–60000/)

  const overCap = await tool.execute({ prompt: '写个周报', maxBytes: 5000 })
  assert.equal(overCap.ok, true, 'a generous cap passes')

  const invalid = await tool.execute({ prompt: '写个周报', maxBytes: 100000 })
  assert.equal(invalid.ok, false)
  assert.match(invalid.error, /supported range is 16–60000/)

  const exact = await tool.execute({ prompt: 'abc', maxBytes: 16 })
  assert.equal(exact.ok, true, '16-byte floor accepted')
})
