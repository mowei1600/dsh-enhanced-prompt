#!/usr/bin/env node
/**
 * Repository text hygiene check (used by CI and `npm run check:text`).
 *
 * Fails when a text file is not clean UTF-8 or was saved with Windows line
 * endings. Generated and vendored trees are skipped.
 *
 * Usage: node scripts/check-text.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['.git', 'node_modules', '.pnpm-store', 'coverage'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md', '.txt', '.ps1', '.sh', '.svg', '.css', '.html'])
const CRLF_ALLOWED = new Set(['.ps1'])

const problems = []
let checked = 0

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.DS_Store')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(full)
      continue
    }
    const ext = path.extname(entry.name).toLowerCase()
    if (!TEXT_EXT.has(ext)) continue
    checked += 1
    const bytes = fs.readFileSync(full)
    const relative = path.relative(ROOT, full)
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      problems.push(`${relative}: UTF-8 BOM`)
      continue
    }
    const text = bytes.toString('utf8')
    if (text.includes('\uFFFD')) problems.push(`${relative}: replacement character (not valid UTF-8)`)
    if (!CRLF_ALLOWED.has(ext) && text.includes('\r\n')) problems.push(`${relative}: CRLF line endings`)
    // Windows PowerShell 5.1 reads BOM-less scripts as ANSI, so a non-ASCII
    // literal in a .ps1 file turns into mojibake when the file is executed.
    // Keep repository scripts ASCII-only (use JSON \u escapes for symbols).
    if (ext === '.ps1' && bytes.some((byte) => byte > 0x7F)) {
      problems.push(`${relative}: non-ASCII byte in a PowerShell script (PS 5.1 misreads BOM-less UTF-8; use \\u escapes)`)
    }
  }
}

walk(ROOT)

if (problems.length > 0) {
  console.error('text hygiene problems:')
  for (const problem of problems) console.error('  -', problem)
  process.exit(1)
}
console.log(`text hygiene ok (${checked} files)`)
