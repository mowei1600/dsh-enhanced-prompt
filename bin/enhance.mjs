#!/usr/bin/env node
/**
 * Standalone CLI for the enhanced-prompt engine.
 *
 * Runs the same deterministic engine the DSH plugin uses, without a Harness
 * process — useful for demos, scripting and verifying the rewrite offline.
 *
 * Usage:
 *   node bin/enhance.mjs [options] <request...>
 *   echo "帮我写个周报" | node bin/enhance.mjs --json
 *
 * Options:
 *   --preset <id>        auto | standard | six-section | goal-oriented | concise | code
 *   --lang <code>        auto | zh | en
 *   --tone <tone>        concise | standard | detailed
 *   --max-bytes <n>      input cap in bytes (default 8000)
 *   --no-original        do not embed the original request
 *   --json               machine-readable result (engine output with timing)
 *   -h, --help           this help
 */

import fs from 'node:fs'
import { enhance, PRESET_IDS } from '../lib/engine.js'

const argv = process.argv.slice(2)
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''))
  process.exit(0)
}

const flag = (name) => argv.includes(`--${name}`)
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const positionals = []
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg.startsWith('--') && ['--preset', '--lang', '--tone', '--max-bytes'].includes(arg)) {
    i += 1
    continue
  }
  if (arg.startsWith('--') || arg === '-h') continue
  positionals.push(arg)
}

const config = {
  preset: option('preset', 'auto'),
  language: option('lang', 'auto'),
  tone: option('tone', 'standard'),
  includeOriginal: !flag('no-original'),
}
const maxBytes = Number(option('max-bytes', ''))
if (Number.isFinite(maxBytes) && maxBytes > 0) config.maxInputBytes = maxBytes

let input = positionals.join(' ').trim()
if (!input && !process.stdin.isTTY) {
  input = fs.readFileSync(0, 'utf8').trim()
}

const started = Date.now()
const result = enhance(input, config)
if (!result.ok) {
  console.error(`error (${result.error.code}): ${result.error.message}`)
  process.exit(1)
}
result.meta = { ...result.meta, elapsedMs: Date.now() - started }

if (flag('json')) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(result.enhanced)
  console.error(
    `— preset=${result.meta.preset} (${result.meta.presetSource}) lang=${result.meta.language} `
    + `intent=${result.meta.intent}/${result.meta.intentConfidence} `
    + `specificity=${result.meta.specificityBefore}->${result.meta.specificityAfter} `
    + `elapsed=${result.meta.elapsedMs}ms warnings=[${result.warnings.join(',')}]`
    + (PRESET_IDS.includes(config.preset) ? '' : ''),
  )
}
