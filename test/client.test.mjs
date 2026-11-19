/**
 * Tests for the browser half (client.js) — no browser, no network required.
 *
 * The generated bundle is evaluated against a fake `window.__ModuleLoader__`, a
 * minimal React stub, and an injected `fetch`, then driven through the same
 * props the DSH composer control row supplies (`useInput` + `inputActions`).
 *
 * These tests pin the contract with the Host bridge:
 *   - one POST /enhance/api per click, carrying the draft and the session id;
 *   - a busy state while the model call runs;
 *   - the rewritten text replaces the draft on success, unchanged on failure;
 *   - 「恢复原文」 writes back the exact previous draft, withdrawn once edited.
 *
 * Run: node --test test/client.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const BUNDLE = path.join(ROOT, 'client.js')

/** A React stub that renders one pass and never re-renders. */
function staticReact() {
  return {
    createElement: (type, config, ...children) => ({
      type,
      props: config || {},
      children: children.flat(Infinity).filter((child) => child !== undefined && child !== null),
    }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
    useCallback: (fn) => fn,
    memo: (component) => component,
  }
}

/** A React stub with real hook state and a synchronous render loop. */
function hookedReact() {
  const slots = []
  let mounted = false
  let cursor = 0
  let component = null
  let props = null
  let tree = null

  const effectDeps = []
  let pendingEffects = []
  let flushing = false

  const flushEffects = () => {
    if (flushing) return
    flushing = true
    try {
      for (const effect of pendingEffects) {
        const previous = effectDeps[effect.index]
        const deps = effect.deps
        const unchanged = previous !== undefined && deps !== undefined
          && previous.length === deps.length
          && deps.every((value, index) => Object.is(value, previous[index]))
        if (unchanged) continue
        effectDeps[effect.index] = deps
        effect.fn()
      }
    } finally {
      pendingEffects = []
      flushing = false
    }
  }

  const render = (nextProps) => {
    if (nextProps !== undefined) props = nextProps
    cursor = 0
    pendingEffects = []
    tree = component(props)
    mounted = true
    flushEffects()
    return tree
  }

  const React = {
    createElement: (type, config, ...children) => ({
      type,
      props: config || {},
      children: children.flat(Infinity).filter((child) => child !== undefined && child !== null),
    }),
    useState: (initial) => {
      const index = cursor++
      if (!mounted || !(index in slots)) {
        slots[index] = typeof initial === 'function' ? initial() : initial
      }
      return [slots[index], (value) => {
        slots[index] = typeof value === 'function' ? value(slots[index]) : value
        render()
      }]
    },
    useRef: (initial) => {
      const index = cursor++
      if (!mounted || !(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useEffect: (fn, deps) => {
      const index = cursor++
      pendingEffects.push({ index, fn, deps })
    },
    useCallback: (fn) => { cursor += 1; return fn },
    memo: (component) => component,
  }

  return {
    React,
    render(comp, nextProps) {
      component = comp
      mounted = false
      slots.length = 0
      return render(nextProps)
    },
    rerender(nextProps) {
      return render(nextProps)
    },
  }
}

/** Evaluate the bundle; `fetchImpl` is injected as the bundle's global fetch. */
function loadBundle(React, fetchImpl) {
  const source = fs.readFileSync(BUNDLE, 'utf8')
  let captured = null
  // eslint-disable-next-line no-new-func
  new Function('window', 'navigator', 'fetch', source)({
    __ModuleLoader__: { load: (definition) => { captured = definition } },
  }, { language: 'zh-CN' }, fetchImpl)
  assert.ok(captured, 'bundle did not call window.__ModuleLoader__.load')
  assert.equal(captured.id, 'dsh-enhanced-prompt')
  return captured.factory((request) => {
    assert.equal(request, 'react', 'the bundle may only require react')
    return React
  })
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function collect(node, out = []) {
  if (!node || typeof node !== 'object') return out
  out.push(node)
  for (const child of node.children || []) collect(child, out)
  return out
}

const buttonsOf = (tree) => collect(tree).filter((node) => node.type === 'button')
const labelOf = (node) => String(node.props['aria-label'] || node.children.join(''))
const byLabel = (tree, text) => buttonsOf(tree).find((node) => labelOf(node).includes(text))
const enhanceButton = (tree) => byLabel(tree, '增强')

test('committed client.js is fresh (regenerate check)', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-client.mjs'), '--check'], {
    encoding: 'utf8',
  })
  assert.match(out, /up to date/)
})

test('bundle registers the composer controls and the Plugins-page settings card', () => {
  const api = loadBundle(staticReact(), async () => jsonResponse(200, { ok: true }))
  assert.deepEqual(api.inject, ['slots'])
  assert.equal(api.__endpoint, '/enhance/api')
  assert.equal(typeof api.apply, 'function')
  assert.match(String(api.__version), /^\d+\.\d+\.\d+$/)

  const registrations = []
  const owners = []
  api.apply({
    slots: {
      inject: (owner, callback) => {
        owners.push(owner)
        callback()
      },
      register: (options, component) => registrations.push({ options, component }),
    },
  })
  assert.deepEqual(owners, ['conversation.input.right', 'plugins.bundle.config'])
  assert.equal(registrations.length, 2)

  const row = registrations.find((entry) => entry.options.name === 'conversation.input.right')
  assert.equal(row.options.id, 'enhanced-prompt')
  assert.equal(row.options.order, 5)
  assert.equal(typeof row.component, 'function')

  const card = registrations.find((entry) => entry.options.name === 'plugins.bundle.config')
  assert.equal(card.options.key, 'dsh-enhanced-prompt', 'keyed by the package name the page looks up')
  assert.equal(card.options.id, 'enhanced-prompt-settings')
  assert.equal(typeof card.component, 'function')
})

test('component is hidden while the draft is empty and renders a 28px icon button otherwise', () => {
  const api = loadBundle(staticReact(), async () => jsonResponse(200, { ok: true }))
  const registrations = []
  api.apply({ slots: { inject: (_owner, callback) => callback(), register: (o, c) => registrations.push({ options: o, component: c }) } })
  const Component = registrations[0].component

  const hidden = Component({
    sessionId: 's1',
    useInput: (selector) => selector({ draft: '' }),
    inputActions: { setDraft: () => {} },
  })
  assert.equal(hidden, null, 'button must be hidden on an empty draft')

  const shown = Component({
    sessionId: 's1',
    useInput: (selector) => selector({ draft: '帮我写个周报' }),
    inputActions: { setDraft: () => {} },
  })
  assert.equal(buttonsOf(shown).length, 2, 'enhance + settings')
  const button = enhanceButton(shown)
  assert.ok(labelOf(button).includes('增强'))
  assert.ok(String(button.props.title).includes('token'), 'tooltip says the call spends tokens')
  assert.ok(collect(button).some((node) => node.type === 'svg'), 'icon-only control renders an SVG glyph')
  assert.equal(button.props.style.width, '28px', 'matches the composer control metrics')
  assert.equal(button.props.style.height, '28px')
})

test('click posts the draft to the bridge and writes the model result back', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return jsonResponse(200, {
      ok: true,
      enhanced: '## 角色\n内容编辑\n\n## 背景\n（待补充）',
      meta: { provider: 'magpie', model: 'ollama/deepseek-v4.1-flash', elapsedMs: 1234 },
    })
  }
  const harness = hookedReact()
  const api = loadBundle(harness.React, fetchImpl)
  const registrations = []
  api.apply({ slots: { inject: (_owner, callback) => callback(), register: (o, c) => registrations.push({ options: o, component: c }) } })
  const Component = registrations[0].component

  const writes = []
  let draft = '帮我写个周报'
  const props = () => ({
    sessionId: 's1',
    useInput: (selector) => selector({ draft }),
    inputActions: { setDraft: (value) => { writes.push(value); draft = value } },
  })

  let tree = harness.render(Component, props())
  enhanceButton(tree).props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/enhance/api')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.credentials, 'same-origin')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.op, 'enhance')
  assert.equal(body.text, '帮我写个周报')
  assert.equal(body.sessionId, 's1')

  assert.equal(writes[writes.length - 1], '## 角色\n内容编辑\n\n## 背景\n（待补充）')
  tree = harness.rerender(props())
  assert.equal(buttonsOf(tree).length, 3, 'enhance + settings + undo')
  assert.ok(buttonsOf(tree).some((node) => labelOf(node).includes('恢复原文')))
})

test('a failed call leaves the draft untouched and shows an error', async () => {
  const fetchImpl = async () => jsonResponse(502, { ok: false, error: { code: 'provider-error', message: 'upstream boom' } })
  const harness = hookedReact()
  const api = loadBundle(harness.React, fetchImpl)
  const registrations = []
  api.apply({ slots: { inject: (_owner, callback) => callback(), register: (o, c) => registrations.push({ options: o, component: c }) } })
  const Component = registrations[0].component

  const writes = []
  let draft = '帮我写个周报'
  const props = () => ({
    sessionId: 's1',
    useInput: (selector) => selector({ draft }),
    inputActions: { setDraft: (value) => { writes.push(value); draft = value } },
  })

  let tree = harness.render(Component, props())
  enhanceButton(tree).props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(writes.length, 0, 'draft must not change on failure')
  tree = harness.rerender(props())
  const error = collect(tree).find((node) => node.props && node.props.role === 'status')
  assert.ok(error, 'error status rendered')
  assert.equal(error.props.title, 'upstream boom')
})

test('button is busy (disabled) while the model call is in flight', async () => {
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const fetchImpl = async () => {
    await pending
    return jsonResponse(200, { ok: true, enhanced: '## 目标\nx', meta: {} })
  }
  const harness = hookedReact()
  const api = loadBundle(harness.React, fetchImpl)
  const registrations = []
  api.apply({ slots: { inject: (_owner, callback) => callback(), register: (o, c) => registrations.push({ options: o, component: c }) } })
  const Component = registrations[0].component

  let draft = '帮我写个周报'
  const props = () => ({
    sessionId: 's1',
    useInput: (selector) => selector({ draft }),
    inputActions: { setDraft: (value) => { draft = value } },
  })

  let tree = harness.render(Component, props())
  enhanceButton(tree).props.onClick()
  tree = harness.rerender(props())
  assert.equal(enhanceButton(tree).props.disabled, true, 'disabled while busy')
  assert.equal(enhanceButton(tree).props['aria-busy'], 'true')

  release()
  await new Promise((resolve) => setTimeout(resolve, 0))
  tree = harness.rerender(props())
  assert.equal(enhanceButton(tree).props.disabled, false, 're-enabled after the call')
})

test('undo restores the exact previous draft and is withdrawn after editing', async () => {
  const fetchImpl = async () => jsonResponse(200, { ok: true, enhanced: '## 目标\n写周报', meta: {} })
  const harness = hookedReact()
  const api = loadBundle(harness.React, fetchImpl)
  const registrations = []
  api.apply({ slots: { inject: (_owner, callback) => callback(), register: (o, c) => registrations.push({ options: o, component: c }) } })
  const Component = registrations[0].component

  const writes = []
  let draft = '帮我写个周报'
  const props = () => ({
    sessionId: 's1',
    useInput: (selector) => selector({ draft }),
    inputActions: { setDraft: (value) => { writes.push(value); draft = value } },
  })

  let tree = harness.render(Component, props())
  enhanceButton(tree).props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  tree = harness.rerender(props())
  assert.equal(buttonsOf(tree).length, 3)

  draft = `${draft}\n\n（手动补充一行）`
  tree = harness.rerender(props())
  assert.equal(buttonsOf(tree).length, 2, 'edited result no longer offers restore')

  draft = '## 目标\n写周报'
  tree = harness.rerender(props())
  const undo = buttonsOf(tree).find((node) => labelOf(node).includes('恢复原文'))
  assert.ok(undo, 'restore returns while the draft still equals the model output')
  undo.props.onClick()
  assert.equal(writes[writes.length - 1], '帮我写个周报', 'restore writes the exact previous draft')
})

test('bundle stays lean: no host DOM queries, storage, node built-ins or ESM imports', () => {
  const source = fs.readFileSync(BUNDLE, 'utf8')
  // Only our own element is touched (ref rect + a keydown listener).
  assert.ok(!/document\.(querySelector|querySelectorAll|getElementById|closest|body)/.test(source), 'no host DOM queries')
  assert.ok(!/\blocalStorage\b/.test(source), 'no storage access')
  assert.ok(!/from\s+['"]node:/.test(source), 'no node built-ins')
  assert.ok(!/^\s*import\s/m.test(source), 'no ESM imports left in the bundle')
  assert.ok(!/require\(['"](?!react['"])/.test(source), 'only react is required')
})

test('settings panel loads over the bridge and saves through it', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const body = JSON.parse(init.body)
    if (body.op === 'settings') {
      return jsonResponse(200, {
        ok: true,
        settings: { strategy: 'llm', style: 'natural', length: 'normal', language: 'auto', includeHistory: true, historyMessages: 6 },
      })
    }
    return jsonResponse(200, {
      ok: true,
      settings: { strategy: 'llm', style: 'structured', length: 'normal', language: 'auto', includeHistory: true, historyMessages: 6 },
    })
  }
  const harness = hookedReact()
  const api = loadBundle(harness.React, fetchImpl)
  const registrations = []
  api.apply({ slots: { inject: (_owner, callback) => callback(), register: (o, c) => registrations.push({ options: o, component: c }) } })
  const Component = registrations[0].component

  const props = () => ({
    sessionId: 's1',
    useInput: (selector) => selector({ draft: '帮我写个周报' }),
    inputActions: { setDraft: () => {} },
  })

  let tree = harness.render(Component, props())
  const gear = byLabel(tree, '设置')
  assert.ok(gear, 'gear button renders next to enhance')
  gear.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls.length, 1)
  assert.equal(JSON.parse(calls[0].init.body).op, 'settings')

  tree = harness.rerender(props())
  const panel = collect(tree).find((node) => node.props && node.props.role === 'dialog')
  assert.ok(panel, 'panel renders after loading settings')
  const selects = collect(panel).filter((node) => node.type === 'select')
  assert.ok(selects.length >= 4, 'strategy/style/length/language selects are rendered')

  const optionLabels = collect(panel)
    .filter((node) => node.type === 'option')
    .map((node) => String(node.children.join('')))
  assert.ok(optionLabels.includes('模型改写（花 token）'), 'select options use Chinese labels')
  assert.ok(optionLabels.includes('提示词正文'))
  assert.ok(optionLabels.includes('自动识别'))

  const checkbox = collect(panel).find((node) => node.type === 'input' && node.props.type === 'checkbox')
  assert.equal(checkbox.props.checked, true, 'conversation context defaults to on')
  const numbers = collect(panel).filter((node) => node.type === 'input' && node.props.type === 'number')
  assert.ok(numbers.length >= 3, 'turn/char/timeout fields are pre-filled with defaults')
  assert.equal(numbers[0].props.value, '6', 'default context turns come from the server')

  const save = collect(panel).find((node) => node.type === 'button' && String(node.children.join('')).includes('保存'))
  assert.ok(save, 'save button exists')
  save.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))

  const savedCall = calls.findIndex((call) => JSON.parse(call.init.body).op === 'saveSettings')
  assert.ok(savedCall >= 0, 'save goes through the bridge')
  assert.equal(JSON.parse(calls[savedCall].init.body).settings.strategy, 'llm')
})

test('Plugins-page card loads, saves and resets the same settings', async () => {
  const calls = []
  const defaults = {
    strategy: 'llm',
    style: 'natural',
    length: 'normal',
    language: 'auto',
    includeHistory: true,
    historyMessages: 6,
    historyChars: 2000,
    extraInstruction: '',
    llm: { provider: '', model: '', timeoutMs: 45000 },
  }
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    if (body.op === 'settings') return jsonResponse(200, { ok: true, settings: defaults, overrides: {} })
    if (body.op === 'saveSettings') return jsonResponse(200, { ok: true, settings: { ...defaults, ...body.settings } })
    if (body.op === 'resetSettings') return jsonResponse(200, { ok: true, settings: defaults, overrides: {} })
    return jsonResponse(404, { ok: false, error: { message: 'unexpected op' } })
  }

  const harness = hookedReact()
  const api = loadBundle(harness.React, fetchImpl)
  const registrations = []
  api.apply({ slots: { inject: (_owner, callback) => callback(), register: (o, c) => registrations.push({ options: o, component: c }) } })
  const Card = registrations.find((entry) => entry.options.name === 'plugins.bundle.config').component

  let tree = harness.render(Card, {})
  await new Promise((resolve) => setTimeout(resolve, 0))
  tree = harness.rerender({})

  const dialog = collect(tree).find((node) => node.props && node.props['data-dsh-plugin'] === 'dsh-enhanced-prompt-config')
  assert.ok(dialog, 'card renders on the plugin page')
  assert.ok(collect(dialog).filter((node) => node.type === 'select').length >= 4, 'all selects render')
  assert.ok(collect(dialog).filter((node) => node.type === 'textarea').length === 1, 'extra requirement textarea renders')

  const buttons = collect(dialog).filter((node) => node.type === 'button')
  const save = buttons.find((node) => String(node.children.join('')).includes('保存'))
  const reset = buttons.find((node) => String(node.children.join('')).includes('恢复默认'))
  assert.ok(save && reset, 'save and reset buttons exist')

  save.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(calls.some((call) => call.op === 'saveSettings'), 'save posts saveSettings')

  reset.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(calls.some((call) => call.op === 'resetSettings'), 'reset posts resetSettings')
})
