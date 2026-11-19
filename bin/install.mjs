#!/usr/bin/env node
/**
 * Install / uninstall / inspect the dsh-enhanced-prompt bundle in a DSH profile.
 *
 * The script reproduces what `plugin_manager` `install_bundle` does for a local
 * directory, without needing the plugin-manager tool:
 *
 *   1. link the package into `$DSH_HOME/plugins/<name>` (junction on Windows),
 *   2. link it into the profile's `node_modules` (what `pnpm add link:` creates),
 *   3. declare the dependency in the profile's package.json,
 *   4. select the bundle in `dsh.profile.bundles`,
 *   5. write a managed override block into the profile's cordis.patch.yml, which
 *      also triggers the profile's HMR configuration reload.
 *
 * Files touched in the profile are snapshotted under
 * `$DSH_HOME/plugins/.backup-<name>-<timestamp>/` before any write.
 *
 * Usage:
 *   node bin/install.mjs [install|uninstall|status] [options]
 *
 * Options:
 *   --profile <name>     DSH profile name            (default: $DSH_PROFILE or "desktop")
 *   --dsh-home <path>    DSH home directory         (default: $DSH_HOME or "~/.dsh")
 *   --copy               copy the package instead of linking it (portable install)
 *   --dry-run            print the plan without writing anything
 *   --json               machine-readable status output
 *   -h, --help           this help
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')
const PKG = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'))
const NAME = PKG.name
const MARK_START = `# >>> ${NAME} (managed by bin/install.mjs) >>>`
const MARK_END = `# <<< ${NAME} (managed by bin/install.mjs) <<<`

const argv = process.argv.slice(2)
const command = argv.find((a) => !a.startsWith('-')) ?? 'install'
const flag = (name) => argv.includes(`--${name}`)
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}

if (flag('help') || command === 'help') {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''))
  process.exit(0)
}

const dryRun = flag('dry-run')
const useCopy = flag('copy')
const dshHome = path.resolve(option('dsh-home', process.env.DSH_HOME || path.join(os.homedir(), '.dsh')))
const profileName = option('profile', process.env.DSH_PROFILE || 'desktop')
const profileDir = path.join(dshHome, 'profiles', profileName)
const profilePkgPath = path.join(profileDir, 'package.json')
const profilePatchPath = path.join(profileDir, 'cordis.patch.yml')
const pluginLinkPath = path.join(dshHome, 'plugins', NAME)
const profileLinkPath = path.join(profileDir, 'node_modules', NAME)

/** Minimal YAML value serializer: JSON is valid YAML 1.2 flow syntax. */
const toYaml = (value) => JSON.stringify(value)

/** Default override config written into the profile patch. */
const OVERRIDE_CONFIG = {
  enabled: true,
  strategy: 'llm',
  style: 'natural',
  length: 'normal',
  preset: 'auto',
  language: 'auto',
  tone: 'standard',
  maxInputBytes: 8000,
  maxInputCharacters: 8000,
  maxOutputBytes: 16000,
  includeOriginal: true,
  allowApply: true,
  extraInstruction: '',
  command: { enabled: true, name: 'enhance' },
  tool: { enabled: true, name: 'enhance_prompt' },
  guidance: { enabled: true, order: 5150, threshold: 45 },
  context: { includeCwd: true, includeWorkspace: true, includeDate: true },
  history: { enabled: true, messages: 6, chars: 2000 },
  llm: {
    provider: '',
    model: '',
    maxOutputTokens: 1400,
    temperature: 0.2,
    timeoutMs: 45000,
    fallbackToRule: false,
  },
  bridge: { enabled: true, maxInFlight: 2 },
  diagnostics: true,
}

const fail = (message) => {
  console.error(`error: ${message}`)
  process.exit(1)
}
const info = (message) => console.log(`${dryRun ? '[dry-run] ' : ''}${message}`)

/** Write one file atomically so an interrupted run can never leave a half-written profile. */
function writeFileAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, file)
}
const exists = (p) => {
  try {
    fs.lstatSync(p)
    return true
  } catch {
    return false
  }
}
const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}
const realpath = (p) => {
  try {
    return fs.realpathSync.native(p)
  } catch {
    return null
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function backup(list) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(dshHome, 'plugins', `.backup-${NAME}-${stamp}`)
  if (!dryRun) fs.mkdirSync(dir, { recursive: true })
  for (const file of list) {
    if (!fs.existsSync(file)) continue
    if (!dryRun) fs.copyFileSync(file, path.join(dir, path.basename(file)))
  }
  return dir
}

/** Remove a directory link (symlink or Windows junction) without touching its target. */
function unlinkPath(linkPath) {
  try {
    fs.unlinkSync(linkPath)
    return
  } catch {
    /* junctions on Windows are directories */
  }
  fs.rmdirSync(linkPath)
}

/** Create (or refresh) a directory link at `linkPath` pointing at `targetPath`. */
function ensureLink(linkPath, targetPath) {
  const current = realpath(linkPath)
  const target = realpath(targetPath) ?? targetPath
  if (current && current === target) return 'unchanged'
  if (exists(linkPath)) {
    if (!isLink(linkPath)) {
      fail(`${linkPath} exists and is a real directory/file; remove it manually (it is not a link we created)`)
    }
    if (!dryRun) unlinkPath(linkPath)
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(linkPath), { recursive: true })
    try {
      fs.symlinkSync(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      fail(`cannot link ${linkPath} -> ${targetPath}: ${error.message}`)
    }
  }
  return current ? 'replaced' : 'created'
}

function removeLink(linkPath) {
  if (!exists(linkPath)) return 'absent'
  if (!isLink(linkPath)) return 'not-a-link'
  if (!dryRun) unlinkPath(linkPath)
  return 'removed'
}

function readPatchBlock() {
  if (!fs.existsSync(profilePatchPath)) return ''
  const text = fs.readFileSync(profilePatchPath, 'utf8')
  const start = text.indexOf(MARK_START)
  const end = text.indexOf(MARK_END)
  if (start < 0 || end < 0 || end < start) return ''
  return text.slice(start, end + MARK_END.length)
}

function stripPatchBlock(text) {
  const start = text.indexOf(MARK_START)
  if (start < 0) return { text, removed: false }
  const end = text.indexOf(MARK_END)
  if (end < 0) return { text, removed: false }
  const after = text.slice(end + MARK_END.length)
  return { text: text.slice(0, start).replace(/\n+$/, '\n') + after.replace(/^\n+/, ''), removed: true }
}

function writeInstall() {
  const pkg = readJson(profilePkgPath)
  pkg.dsh = pkg.dsh && typeof pkg.dsh === 'object' ? pkg.dsh : {}
  pkg.dsh.profile = pkg.dsh.profile && typeof pkg.dsh.profile === 'object' ? pkg.dsh.profile : {}
  const currentBundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
  const nextBundles = currentBundles.includes(NAME) ? currentBundles : [...currentBundles, NAME]
  pkg.dependencies = pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}
  const linkSpec = `link:../../plugins/${NAME}`
  pkg.dependencies[NAME] = linkSpec
  pkg.dsh.profile.bundles = nextBundles
  const patch = fs.existsSync(profilePatchPath) ? fs.readFileSync(profilePatchPath, 'utf8') : '# profile patch layer\n'
  const block = [
    MARK_START,
    `# installed-at: ${new Date().toISOString()}`,
    '# Managed by the bundle installer: restates the row config so the profile patch',
    '# stays authoritative over the bundle default. Edit values here, keep the markers.',
    `- id: enhanced-prompt`,
    `  config: ${toYaml(OVERRIDE_CONFIG)}`,
    MARK_END,
    '',
  ].join('\n')
  const { text: withoutOld } = stripPatchBlock(patch)
  const nextPatch = `${withoutOld.replace(/\s*$/, '')}\n\n${block}`
  if (dryRun) {
    info(`would set dependencies.${NAME} = ${linkSpec}`)
    info(`would append bundle ${NAME} (total ${nextBundles.length})`)
    info(`would write managed override block into ${profilePatchPath}`)
    return
  }
  writeFileAtomic(profilePkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  writeFileAtomic(profilePatchPath, nextPatch)
}

function statusReport() {
  const pkg = fs.existsSync(profilePkgPath) ? readJson(profilePkgPath) : null
  const bundles = pkg?.dsh?.profile?.bundles ?? []
  const dep = pkg?.dependencies?.[NAME] ?? null
  return {
    plugin: { name: NAME, version: PKG.version, root: PKG_ROOT },
    dshHome,
    profile: profileName,
    profileDir,
    profileExists: fs.existsSync(profileDir),
    dependency: dep,
    bundleSelected: bundles.includes(NAME),
    bundlePosition: bundles.indexOf(NAME),
    pluginLink: { path: pluginLinkPath, exists: exists(pluginLinkPath), target: realpath(pluginLinkPath) },
    profileLink: { path: profileLinkPath, exists: exists(profileLinkPath), target: realpath(profileLinkPath) },
    patchBlock: readPatchBlock() ? 'present' : 'absent',
  }
}

function main() {
  if (!fs.existsSync(profileDir)) fail(`profile directory not found: ${profileDir}`)
  if (!fs.existsSync(profilePkgPath)) fail(`profile package.json not found: ${profilePkgPath}`)

  if (command === 'status') {
    const report = statusReport()
    if (flag('json')) console.log(JSON.stringify(report, null, 2))
    else {
      console.log(`${NAME} v${report.plugin.version}
  plugin root     ${report.plugin.root}
  dsh home        ${dshHome}
  profile         ${profileName}
  dependency      ${report.dependency ?? '(not declared)'}
  bundle selected ${report.bundleSelected ? `yes (position ${report.bundlePosition})` : 'no'}
  plugin link     ${report.pluginLink.exists ? report.pluginLink.target : '(missing)'}
  profile link    ${report.profileLink.exists ? report.profileLink.target : '(missing)'}
  patch override  ${report.patchBlock}`)
    }
    process.exit(report.bundleSelected && report.profileLink.exists ? 0 : 2)
  }

  if (command === 'install') {
    const backupDir = (() => {
      if (dryRun) return '(dry-run)'
      return backup([profilePkgPath, profilePatchPath, path.join(profileDir, 'pnpm-lock.yaml')])
    })()
    info(`backup: ${backupDir}`)
    if (useCopy) {
      if (!dryRun) {
        if (exists(pluginLinkPath) && isLink(pluginLinkPath)) unlinkPath(pluginLinkPath)
        else fs.rmSync(pluginLinkPath, { recursive: true, force: true })
        fs.cpSync(PKG_ROOT, pluginLinkPath, { recursive: true })
      }
      info(`copied package to ${pluginLinkPath}`)
    } else {
      info(`plugin link ${ensureLink(pluginLinkPath, PKG_ROOT)}: ${pluginLinkPath} -> ${PKG_ROOT}`)
    }
    writeInstall()
    info(`profile link ${ensureLink(profileLinkPath, pluginLinkPath)}: ${profileLinkPath} -> ${pluginLinkPath}`)
    info('done. The profile HMR watcher should reload the configuration; if the plugin does not')
    info('activate within a few seconds, restart DSH. Verify with `/enhance status` in a chat.')
    return
  }

  if (command === 'uninstall') {
    if (!dryRun) backup([profilePkgPath, profilePatchPath])
    const pkg = readJson(profilePkgPath)
    if (pkg.dependencies && NAME in pkg.dependencies) {
      delete pkg.dependencies[NAME]
      info(`removed dependency ${NAME}`)
    }
    if (pkg.dsh?.profile?.bundles) {
      pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== NAME)
      info(`removed bundle ${NAME}`)
    }
    if (!dryRun) writeFileAtomic(profilePkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    if (fs.existsSync(profilePatchPath)) {
      const { text, removed } = stripPatchBlock(fs.readFileSync(profilePatchPath, 'utf8'))
      if (removed) {
        if (!dryRun) writeFileAtomic(profilePatchPath, text)
        info('removed managed override block')
      }
    }
    info(`profile link ${removeLink(profileLinkPath)}`)
    info(`plugin link ${removeLink(pluginLinkPath)}`)
    info('done. Restart DSH if the plugin was running at startup.')
    return
  }

  fail(`unknown command "${command}" (expected install, uninstall or status)`)
}

main()
