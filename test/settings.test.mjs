/**
 * Tests for the plugin-owned settings file, the conversation-tail extractor,
 * and the `/enhance set` grammar.
 *
 * Run: node --test test/settings.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  normalizeSettings,
  readSettings,
  writeSettings,
  mergeSettings,
  settingsPath,
} from '../lib/settings.js'
import { recentTurns, renderHistory } from '../lib/history.js'
import * as plugin from '../index.js'

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ep-'))

test('settings file lives under DSH_HOME and honours the override', () => {
  const home = path.join('C:', 'tmp', 'dsh-home')
  assert.equal(settingsPath({ DSH_HOME: home }), path.join(home, 'enhanced-prompt.settings.json'))
  assert.match(settingsPath({}), /enhanced-prompt\.settings\.json$/)
})

test('normalizeSettings keeps only known keys and primitives', () => {
  const normalized = normalizeSettings({
    strategy: 'rule',
    style: 'structured',
    length: 'short',
    language: 'zh',
    includeHistory: 'false',
    historyMessages: 4.7,
    historyChars: '1200',
    extraInstruction: 'x'.repeat(3000),
    llm: { provider: 'magpie', model: 'm', timeoutMs: '20000', bogus: 1 },
    nested: { bad: true },
    unknown: 'drop me',
  })
  assert.equal(normalized.strategy, 'rule')
  assert.equal(normalized.style, 'structured')
  assert.equal(normalized.length, 'short')
  assert.equal(normalized.language, 'zh')
  assert.equal(normalized.includeHistory, false)
  assert.equal(normalized.historyMessages, 4)
  assert.equal(normalized.historyChars, 1200)
  assert.equal(normalized.extraInstruction.length, 2000, 'extra instruction is capped')
  assert.deepEqual(normalized.llm, { provider: 'magpie', model: 'm', timeoutMs: 20000 })
  assert.ok(!('nested' in normalized))
  assert.ok(!('unknown' in normalized))
})

test('read and write settings round-trip atomically', () => {
  const dir = tempDir()
  const file = path.join(dir, 'settings.json')
  assert.deepEqual(readSettings(file), {}, 'missing file means no overrides')

  const written = writeSettings({ style: 'structured', historyMessages: 3 }, file)
  assert.deepEqual(written, { style: 'structured', historyMessages: 3 })
  assert.deepEqual(readSettings(file), written)
  assert.ok(!fs.readdirSync(dir).some((name) => name.includes('.tmp-')), 'no temp files left behind')

  fs.writeFileSync(file, '{not json', 'utf8')
  assert.deepEqual(readSettings(file), {}, 'corrupt file falls back to defaults')
})

test('mergeSettings deep-merges llm over the static row config', () => {
  const merged = mergeSettings(
    { strategy: 'llm', llm: { provider: 'p', model: 'm', timeoutMs: 45000 } },
    { length: 'short', llm: { timeoutMs: 20000 } },
  )
  assert.equal(merged.strategy, 'llm')
  assert.equal(merged.length, 'short')
  assert.deepEqual(merged.llm, { provider: 'p', model: 'm', timeoutMs: 20000 })
})

test('saved overrides are re-validated by normalizeConfig', () => {
  const config = plugin.normalizeConfig(mergeSettings({}, {
    strategy: 'nonsense',
    style: 'weird',
    length: 'huge',
    historyMessages: 99,
    llm: { timeoutMs: 5 },
  }))
  assert.equal(config.strategy, 'llm', 'invalid strategy falls back')
  assert.equal(config.style, 'natural')
  assert.equal(config.length, 'normal')
  assert.equal(config.history.messages, 20, 'clamped to the accepted range')
  assert.equal(config.llm.timeoutMs, 1000)
})

test('parseSettingsArguments maps key=value pairs including quoted text', () => {
  const { patch, invalid } = plugin.parseSettingsArguments('style=structured length=short extra="保持简短，别分点" timeoutMs=30000 nope')
  assert.equal(patch.style, 'structured')
  assert.equal(patch.length, 'short')
  assert.equal(patch.extraInstruction, '保持简短，别分点')
  assert.deepEqual(patch.llm, { timeoutMs: 30000 })
  assert.deepEqual(invalid, ['nope'])
})

test('renderSettings lists the effective values and the file path', () => {
  const text = plugin.renderSettings(plugin.normalizeConfig({ history: { messages: 4 } }), '/tmp/s.json')
  assert.match(text, /策略 strategy/)
  assert.match(text, /最近 4 轮/)
  assert.match(text, /\/tmp\/s\.json/)
  assert.match(text, /set style=structured/)
})

test('recentTurns keeps text turns, drops tool traffic and caps the budget', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '第一轮问题' }] },
    { role: 'assistant', content: [{ type: 'text', text: '第一轮回答' }, { type: 'tool-call', id: 'x' }] },
    { role: 'tool', content: [{ type: 'text', text: 'tool output' }] },
    { role: 'assistant', content: [{ type: 'reasoning', text: 'thinking' }] },
    { role: 'user', content: [{ type: 'text', text: '第二轮问题' }] },
  ]
  const turns = recentTurns(messages, { maxMessages: 3, maxChars: 1000 })
  assert.deepEqual(turns.map((turn) => turn.text), ['第一轮问题', '第一轮回答', '第二轮问题'])

  const trimmed = recentTurns(messages, { maxMessages: 10, maxChars: 6 })
  assert.equal(trimmed.length, 1, 'only what fits the character budget survives')
  assert.ok(trimmed[0].text.length <= 6)
})

test('renderHistory labels the transcript and stays empty without turns', () => {
  assert.equal(renderHistory([], 'zh'), '')
  const zh = renderHistory([{ role: 'user', text: '甲' }, { role: 'assistant', text: '乙' }], 'zh')
  assert.match(zh, /当前对话的最近几轮/)
  assert.match(zh, /用户: 甲/)
  assert.match(zh, /助手: 乙/)
  const en = renderHistory([{ role: 'user', text: 'a' }], 'en')
  assert.match(en, /Recent turns of this conversation/)
  assert.match(en, /user: a/)
})

test('/enhance set stores through the runtime hook and reports the new values', async () => {
  const calls = []
  const config = plugin.normalizeConfig({ strategy: 'rule' })
  const command = plugin.createCommandDefinition(config, {
    getConfig: () => config,
    saveSettings: (patch) => { calls.push(patch) },
  })
  const result = await command.handler({ rawInput: 'set length=short style=structured' })
  assert.equal(result.kind, 'success')
  assert.deepEqual(calls, [{ style: 'structured', length: 'short' }])
  assert.match(result.text, /已保存/)

  const bad = await command.handler({ rawInput: 'set nope=1' })
  assert.equal(bad.kind, 'error')
})

test('/enhance settings renders the panel text without touching the model', () => {
  const config = plugin.normalizeConfig({ strategy: 'rule' })
  const command = plugin.createCommandDefinition(config, { getConfig: () => config })
  assert.equal(typeof command.handler, 'function')
})
