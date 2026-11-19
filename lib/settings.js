/**
 * Plugin-owned, runtime-editable settings.
 *
 * The profile patch stays the deployment default; this file holds the user's
 * overrides, written from the composer settings panel or `/enhance set`.
 * Everything is re-validated through `normalizeConfig()` after merging, so an
 * edited file can never inject an invalid strategy, route or oversized input.
 *
 * File: `$DSH_HOME/enhanced-prompt.settings.json` (atomic write, no temp litter).
 *
 * @module dsh-enhanced-prompt/lib/settings
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Shape version of the settings file. */
export const SETTINGS_VERSION = 1

/** Flat keys the panel may change. */
export const FLAT_KEYS = [
  'strategy',
  'style',
  'length',
  'language',
  'tone',
  'includeHistory',
  'historyMessages',
  'historyChars',
  'extraInstruction',
]

/** Nested keys the panel may change. */
export const NESTED_KEYS = {
  llm: ['provider', 'model', 'maxOutputTokens', 'temperature', 'timeoutMs'],
}

/** Resolve the settings file path for the current harness home. */
export function settingsPath(env = process.env) {
  const home = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim() ? env.DSH_HOME : path.join(os.homedir(), '.dsh')
  return path.join(home, 'enhanced-prompt.settings.json')
}

const coerceString = (value, max) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

/**
 * Keep only known keys and primitive shapes. Unknown keys are dropped, so a
 * hand-edited file cannot smuggle arbitrary config into the plugin.
 *
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeSettings(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const key of FLAT_KEYS) {
    if (!(key in raw)) continue
    const value = raw[key]
    if (key === 'extraInstruction') {
      const text = coerceString(value, 2000)
      if (text !== undefined) out[key] = text
      continue
    }
    if (key === 'includeHistory') {
      if (typeof value === 'boolean') out[key] = value
      else if (value === 'true' || value === 'false') out[key] = value === 'true'
      continue
    }
    if (key === 'historyMessages' || key === 'historyChars') {
      const n = Number(value)
      if (Number.isFinite(n)) out[key] = Math.trunc(n)
      continue
    }
    const text = coerceString(String(value ?? ''), 60)
    if (text) out[key] = text
  }
  const llm = raw.llm
  if (llm !== null && typeof llm === 'object' && !Array.isArray(llm)) {
    const nested = {}
    for (const key of NESTED_KEYS.llm) {
      if (!(key in llm)) continue
      const value = llm[key]
      if (key === 'provider' || key === 'model') {
        const text = coerceString(value, 200)
        if (text !== undefined) nested[key] = text
      } else {
        const n = Number(value)
        if (Number.isFinite(n)) nested[key] = n
      }
    }
    if (Object.keys(nested).length > 0) out.llm = nested
  }
  return out
}

/**
 * Read the settings file. A missing or unreadable file means "no overrides".
 *
 * @param {string} [file]
 * @returns {Record<string, unknown>}
 */
export function readSettings(file = settingsPath()) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    return normalizeSettings(parsed)
  } catch {
    return {}
  }
}

/**
 * Persist settings atomically (temp file + rename) and return the normalized
 * value that was written.
 *
 * @param {Record<string, unknown>} raw
 * @param {string} [file]
 * @returns {Record<string, unknown>}
 */
export function writeSettings(raw, file = settingsPath()) {
  const next = normalizeSettings(raw)
  const payload = JSON.stringify({ version: SETTINGS_VERSION, ...next }, null, 2) + '\n'
  const temp = `${file}.tmp-${process.pid}`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(temp, payload, 'utf8')
  fs.renameSync(temp, file)
  return next
}

/**
 * Deep-merge the saved overrides over the static row config.
 *
 * The panel speaks flat keys (`includeHistory`, `historyMessages`,
 * `historyChars`); the row config groups them under `history`. Translate here so
 * one source of truth (normalizeConfig) validates everything.
 */
export function mergeSettings(staticConfig, saved) {
  const base = staticConfig !== null && typeof staticConfig === 'object' ? staticConfig : {}
  const overrides = saved !== null && typeof saved === 'object' ? saved : {}
  const { includeHistory, historyMessages, historyChars, ...flat } = overrides
  const merged = { ...base, ...flat }
  if (base.llm || flat.llm) {
    merged.llm = { ...(base.llm ?? {}), ...(flat.llm ?? {}) }
  }
  const hasHistoryOverride = includeHistory !== undefined || historyMessages !== undefined || historyChars !== undefined
  if (hasHistoryOverride || base.history) {
    merged.history = { ...(base.history ?? {}) }
    if (includeHistory !== undefined) merged.history.enabled = includeHistory
    if (historyMessages !== undefined) merged.history.messages = historyMessages
    if (historyChars !== undefined) merged.history.chars = historyChars
  }
  return merged
}
