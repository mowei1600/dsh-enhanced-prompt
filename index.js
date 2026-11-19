/**
 * dsh-enhanced-prompt — LLM-backed "enhanced prompt" for DeepSeek Harness.
 *
 * Takes a rough one-line request and expands it into a structured, ready-to-send
 * prompt. This is an independent implementation; it reproduces the interaction
 * pattern (input handling → structured rewrite → preview → apply), not any
 * vendor's prompt text, assets or branding.
 *
 * Host half of the bundle. It owns the rewriting and exposes it through:
 *
 *   1. `/enhance` slash command  — human entry point (preview, apply, status, help).
 *   2. `enhance_prompt` tool     — model entry point, so an agent can restate a
 *                                  vague request before acting on it.
 *   3. `system-prompt` section   — optional, thresholded guidance telling the
 *                                  model when to use the tool.
 *   4. `POST /enhance/api`       — same-origin bridge for the composer button.
 *
 * Rewriting is one model call through `ctx.llm` (spends tokens by design); the
 * deterministic engine stays available with `strategy: 'rule'`.
 *
 * Everything is scoped to the plugin own context and is disposed by Cordis when
 *
 * @module dsh-enhanced-prompt
 */

import { randomUUID } from 'node:crypto'

import * as engine from './lib/engine.js'
import { rewriteWithModel, resolveRoute, LLM_ERRORS } from './lib/llm.js'
import { createBridgeHandler, registerBridge, BRIDGE_PATH } from './lib/bridge.js'
import { recentTurns, renderHistory } from './lib/history.js'
import { readSettings, writeSettings, mergeSettings, normalizeSettings, settingsPath } from './lib/settings.js'

/** Plugin version, kept in sync with package.json. */
export const VERSION = '1.4.0'

/** Cordis plugin name (also the loader row id by default). */
export const name = 'enhanced-prompt'

/** Default row configuration; the bundle patch restates the same values. */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  /** 'llm' spends tokens on a real model call; 'rule' is the offline engine. */
  strategy: 'llm',
  /** 'natural' = plain prompt text; 'structured' = the classic sectioned layout. */
  style: 'natural',
  /** Output budget forwarded to the model: short | normal | detailed. */
  length: 'normal',
  preset: 'auto',
  language: 'auto',
  tone: 'standard',
  maxInputBytes: 8000,
  maxInputCharacters: 8000,
  maxOutputBytes: 16000,
  includeOriginal: true,
  allowApply: true,
  /** Free-form user instruction appended to the rewrite rules. */
  extraInstruction: '',
  command: { enabled: true, name: 'enhance' },
  tool: { enabled: true, name: 'enhance_prompt' },
  guidance: { enabled: true, order: 5150, threshold: 45 },
  context: { includeCwd: true, includeWorkspace: true, includeDate: true },
  /** Conversation tail handed to the rewrite so follow-ups keep their referents. */
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
})

/** Allowed preset ids, mirrored from the engine (fallback keeps this file standalone). */
const PRESET_IDS = Array.isArray(engine.PRESET_IDS) && engine.PRESET_IDS.length > 0
  ? [...engine.PRESET_IDS]
  : ['auto', 'standard', 'six-section', 'goal-oriented', 'concise', 'code']
/** Allowed languages. */
const LANGUAGES = ['auto', 'zh', 'en']
/** Allowed tones. */
const TONES = ['concise', 'standard', 'detailed']
/** Allowed output styles and budgets. */
const STYLES = ['natural', 'structured']
const LENGTHS = ['short', 'normal', 'detailed']
/** Slash-command grammar enforced by the command adapter. */
const COMMAND_NAME = /^[a-z0-9][a-z0-9_-]*$/
/** Tool-name grammar accepted by the tool registry. */
const TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

const clampInt = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

const pick = (value, allowed, fallback) => {
  const v = String(value ?? '').trim().toLowerCase()
  return allowed.includes(v) ? v : fallback
}

const bool = (value, fallback) => {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

/**
 * Merge a raw loader row config with defaults, validate it, and return the
 * non-fatal warnings so callers never rely on module-level state.
 *
 * @param {unknown} raw - the `config` object from the loader row.
 * @returns {{ config: typeof DEFAULT_CONFIG, warnings: string[] }}
 */
export function normalizeConfigResult(raw) {
  const warnings = []
  const src = raw !== null && typeof raw === 'object' ? raw : {}
  const commandNameRaw = String(src.command?.name ?? DEFAULT_CONFIG.command.name).trim().toLowerCase()
  const commandName = COMMAND_NAME.test(commandNameRaw) ? commandNameRaw : DEFAULT_CONFIG.command.name
  if (commandNameRaw && commandNameRaw !== commandName) {
    warnings.push(`invalid command name "${commandNameRaw}", using "${commandName}"`)
  }
  const toolNameRaw = String(src.tool?.name ?? DEFAULT_CONFIG.tool.name).trim()
  const toolName = TOOL_NAME.test(toolNameRaw) ? toolNameRaw : DEFAULT_CONFIG.tool.name
  if (toolNameRaw && toolNameRaw !== toolName) {
    warnings.push(`invalid tool name "${toolNameRaw}", using "${toolName}"`)
  }
  const out = {
    enabled: bool(src.enabled, DEFAULT_CONFIG.enabled),
    strategy: pick(src.strategy, ['llm', 'rule'], DEFAULT_CONFIG.strategy),
    style: pick(src.style, STYLES, DEFAULT_CONFIG.style),
    length: pick(src.length, LENGTHS, DEFAULT_CONFIG.length),
    preset: pick(src.preset, PRESET_IDS, DEFAULT_CONFIG.preset),
    language: pick(src.language, LANGUAGES, DEFAULT_CONFIG.language),
    tone: pick(src.tone, TONES, DEFAULT_CONFIG.tone),
    maxInputBytes: clampInt(src.maxInputBytes, DEFAULT_CONFIG.maxInputBytes, 256, 60000),
    maxInputCharacters: clampInt(src.maxInputCharacters, DEFAULT_CONFIG.maxInputCharacters, 256, 60000),
    maxOutputBytes: clampInt(src.maxOutputBytes, DEFAULT_CONFIG.maxOutputBytes, 512, 60000),
    includeOriginal: bool(src.includeOriginal, DEFAULT_CONFIG.includeOriginal),
    allowApply: bool(src.allowApply, DEFAULT_CONFIG.allowApply),
    extraInstruction: String(src.extraInstruction ?? DEFAULT_CONFIG.extraInstruction).slice(0, 2000).trim(),
    command: {
      enabled: bool(src.command?.enabled, DEFAULT_CONFIG.command.enabled),
      name: commandName,
    },
    tool: {
      enabled: bool(src.tool?.enabled, DEFAULT_CONFIG.tool.enabled),
      name: toolName,
    },
    guidance: {
      enabled: bool(src.guidance?.enabled, DEFAULT_CONFIG.guidance.enabled),
      order: Number.isFinite(Number(src.guidance?.order)) ? Number(src.guidance.order) : DEFAULT_CONFIG.guidance.order,
      threshold: clampInt(src.guidance?.threshold, DEFAULT_CONFIG.guidance.threshold, 1, 100),
    },
    context: {
      includeCwd: bool(src.context?.includeCwd, DEFAULT_CONFIG.context.includeCwd),
      includeWorkspace: bool(src.context?.includeWorkspace, DEFAULT_CONFIG.context.includeWorkspace),
      includeDate: bool(src.context?.includeDate, DEFAULT_CONFIG.context.includeDate),
    },
    history: {
      enabled: bool(src.history?.enabled, DEFAULT_CONFIG.history.enabled),
      messages: clampInt(src.history?.messages, DEFAULT_CONFIG.history.messages, 0, 20),
      chars: clampInt(src.history?.chars, DEFAULT_CONFIG.history.chars, 200, 8000),
    },
    llm: {
      provider: String(src.llm?.provider ?? DEFAULT_CONFIG.llm.provider).trim(),
      model: String(src.llm?.model ?? DEFAULT_CONFIG.llm.model).trim(),
      maxOutputTokens: clampInt(src.llm?.maxOutputTokens, DEFAULT_CONFIG.llm.maxOutputTokens, 64, 16000),
      temperature: Math.min(2, Math.max(0, Number.isFinite(Number(src.llm?.temperature))
        ? Number(src.llm.temperature)
        : DEFAULT_CONFIG.llm.temperature)),
      timeoutMs: clampInt(src.llm?.timeoutMs, DEFAULT_CONFIG.llm.timeoutMs, 1000, 300000),
      fallbackToRule: bool(src.llm?.fallbackToRule, DEFAULT_CONFIG.llm.fallbackToRule),
    },
    bridge: {
      enabled: bool(src.bridge?.enabled, DEFAULT_CONFIG.bridge.enabled),
      maxInFlight: clampInt(src.bridge?.maxInFlight, DEFAULT_CONFIG.bridge.maxInFlight, 1, 16),
    },
    diagnostics: bool(src.diagnostics, DEFAULT_CONFIG.diagnostics),
  }
  if (src.preset !== undefined && !PRESET_IDS.includes(String(src.preset).toLowerCase())) {
    warnings.push(`unknown preset "${src.preset}", using "${out.preset}"`)
  }
  if (src.language !== undefined && !LANGUAGES.includes(String(src.language).toLowerCase())) {
    warnings.push(`unknown language "${src.language}", using "${out.language}"`)
  }
  if (src.tone !== undefined && !TONES.includes(String(src.tone).toLowerCase())) {
    warnings.push(`unknown tone "${src.tone}", using "${out.tone}"`)
  }
  return { config: out, warnings }
}

/**
 * Merge a raw loader row config with defaults and validate it.
 *
 * @param {unknown} raw - the `config` object from the loader row.
 * @returns {typeof DEFAULT_CONFIG} a fully populated, validated configuration.
 */
export function normalizeConfig(raw) {
  return normalizeConfigResult(raw).config
}

/** Host paths that must never leak into a model-visible prompt as "workspace". */
const HARNESS_INTERNAL_PATH = /(^|[\\/])(\.dsh|\.agents)([\\/]|$)/i

/** True when `value` looks like a DSH home/profile path rather than a user workspace. */
function isHarnessInternalPath(value) {
  return typeof value === 'string' && HARNESS_INTERNAL_PATH.test(value)
}

/**
 * Resolve the Session's effective working directory through the Host service.
 *
 * There is deliberately no `process.cwd()` fallback: a Desktop Host's process
 * directory is the profile directory (`$DSH_HOME/profiles/<name>`), and a
 * minimal profile without the `workingDirectory` service must not leak a host
 * path into model-visible text. Without the service the engine simply receives
 * no cwd fact.
 */
function resolveWorkingDirectory(runtime, agent) {
  try {
    const fromService = runtime?.getWorkingDirectory?.(agent)
    if (typeof fromService === 'string' && fromService.length > 0) return fromService
  } catch {
    /* service unavailable for this scope */
  }
  return undefined
}

/** Collect the caller facts handed to the engine; never invents any. */
function collectContext(cfg, runtime, agent) {
  const context = {}
  const cwd = resolveWorkingDirectory(runtime, agent)
  const usable = cwd && !isHarnessInternalPath(cwd) ? cwd : undefined
  if (cfg.context.includeCwd && usable) context.cwd = usable
  if (cfg.context.includeWorkspace && usable) {
    const base = usable.split(/[\\/]/).filter(Boolean).pop()
    if (base) context.workspace = base
  }
  if (cfg.context.includeDate) {
    context.date = new Date().toISOString().slice(0, 10)
  }
  return context
}

/** Build the engine config consumed by `enhance()` from a normalized host config. */
function engineConfig(cfg, overrides = {}, context = {}) {
  return {
    preset: overrides.preset ?? cfg.preset,
    language: overrides.language ?? cfg.language,
    tone: overrides.tone ?? cfg.tone,
    maxInputBytes: overrides.maxInputBytes ?? cfg.maxInputBytes,
    maxOutputBytes: cfg.maxOutputBytes,
    includeOriginal: cfg.includeOriginal,
    ...(Object.keys(context).length > 0 ? { context } : {}),
  }
}

/** Run the offline rule engine and attach host-measured timing. */
function runRule(raw, cfg, overrides = {}, context = {}) {
  const started = Date.now()
  const result = engine.enhance(raw, engineConfig(cfg, overrides, context))
  if (result && result.ok) {
    result.meta = { ...result.meta, strategy: 'rule', elapsedMs: Date.now() - started }
  }
  return result
}

/**
 * Run one rewrite according to `strategy`.
 *
 * - `llm` (default): one model call through the Host's `ctx.llm`; spends tokens.
 * - `rule`: deterministic offline engine (explicit opt-in only).
 *
 * `llm.fallbackToRule` is off by default: a provider failure is reported instead
 * of silently switching to different output.
 *
 * @param {object} ctx - Host context (needs `llm` and optionally `agentDefaultModel`).
 * @param {string} raw - user draft.
 * @param {object} cfg - normalized plugin config.
 * @param {{ preset?: string, language?: string, tone?: string }} overrides
 * @param {Record<string, string>} context - caller facts (date / workspace).
 * @param {AbortSignal} [signal]
 * @param {string} [history] - rendered conversation tail (see lib/history.js).
 * @returns {Promise<object>} engine-shaped result
 */
async function runRewrite(ctx, raw, cfg, overrides = {}, context = {}, signal, getDefaultModel, history) {
  if (cfg.strategy === 'rule') return runRule(raw, cfg, overrides, context)
  const started = Date.now()
  try {
    const model = await rewriteWithModel(ctx, cfg.llm, {
      text: raw,
      language: overrides.language ?? cfg.language,
      style: cfg.style,
      length: cfg.length,
      extraInstruction: cfg.extraInstruction,
      context,
      history,
      signal,
      getDefaultModel,
    })
    return {
      ok: true,
      original: raw,
      enhanced: model.enhanced,
      sections: [],
      meta: {
        preset: overrides.preset ?? cfg.preset,
        language: model.language,
        strategy: 'llm',
        provider: model.provider,
        model: model.model,
        routeSource: model.routeSource,
        elapsedMs: Date.now() - started,
      },
      warnings: [],
    }
  } catch (error) {
    if (cfg.llm.fallbackToRule) {
      const fallback = runRule(raw, cfg, overrides, context)
      if (fallback.ok) {
        fallback.meta = { ...fallback.meta, strategy: 'rule-fallback' }
        fallback.warnings = [...(fallback.warnings ?? []), 'llm-fallback']
        return fallback
      }
    }
    return {
      ok: false,
      error: {
        code: (error && error.code) || 'provider-error',
        message: String((error && error.message) || 'model rewrite failed'),
      },
    }
  }
}

/** Human-readable text for an LLM failure code. */
const LLM_ERROR_TEXT = {
  zh: {
    'no-route': '没有可用的模型路由：请在插件配置里设置 llm.provider / llm.model，或在「模型」设置里选一个默认模型。',
    'llm-unavailable': '宿主没有 llm 服务，无法调用模型。',
    timeout: '模型调用超时，请重试或调大 llm.timeoutMs。',
    cancelled: '模型调用已取消。',
    'provider-error': '模型调用失败：',
    'empty-output': '模型没有返回内容。',
    'llm-fallback': '模型不可用，已回退到离线规则引擎。',
  },
  en: {
    'no-route': 'No model route: set llm.provider / llm.model in the plugin config, or pick a default model in Settings.',
    'llm-unavailable': 'The Host has no llm service, so the model cannot be called.',
    timeout: 'The model call timed out; retry or raise llm.timeoutMs.',
    cancelled: 'The model call was cancelled.',
    'provider-error': 'The model call failed: ',
    'empty-output': 'The model returned no content.',
    'llm-fallback': 'The model was unavailable; the offline rule engine was used instead.',
  },
}

/** Render a failed result as text for the given surface and language. */
function renderRewriteError(result, lang = 'zh') {
  const table = LLM_ERROR_TEXT[lang] ?? LLM_ERROR_TEXT.zh
  const code = result?.error?.code ?? 'provider-error'
  const prefix = table[code]
  if (code === 'provider-error') return `${prefix ?? ''}${result?.error?.message ?? ''}`.trim()
  if (code === 'invalid-config' || code === 'empty-input' || code === 'too-long') {
    return MESSAGES[lang === 'en' ? 'en' : 'zh'].engineError[code] ?? result?.error?.message ?? 'enhancement failed'
  }
  return prefix ?? result?.error?.message ?? 'rewrite failed'
}

const MESSAGES = {
  zh: {
    title: '增强提示词',
    source: (chars, before, after) => `原输入 ${chars} 字 · 具体度 ${before} → ${after}`,
    footer: '应用：把上面的文本复制回输入框；或运行 `/enhance apply <你的粗提示词>` 直接以增强结果发起请求。',
    toolFooter: '（以上为增强后的提示词，可直接据此执行；原始请求已保留在结果里。）',
    usage: '用法：`/enhance <粗提示词>` 预览；`/enhance apply <粗提示词>` 预览并直接发送；`/enhance preset <id> <粗提示词>` 换模板；`/enhance status` 查看配置；`/enhance help` 帮助。',
    empty: '没有收到要增强的内容。请把需求写在命令后面，例如：`/enhance 帮我写个周报`。',
    applied: '已增强并作为下一条消息提交（原始需求保留在会话日志中）。',
    notApplied: '当前配置不允许 `/enhance apply`（allowApply: false），已改为预览。',
    engineError: {
      'empty-input': '输入为空：请把要增强的需求写在命令后面。',
      'invalid-config': '增强配置无效，请检查插件配置。',
      'too-long': '输入超过长度上限，请缩短后重试。',
    },
    status: (cfg, v) => [
      `增强提示词 v${v}`,
      `策略 ${cfg.strategy === 'llm' ? '模型改写（花 token）' : '离线规则引擎'} · 模型 ${cfg.llm.provider && cfg.llm.model ? `${cfg.llm.provider}/${cfg.llm.model}` : '跟随会话默认模型'}`,
      `预设 ${cfg.preset} · 语言 ${cfg.language} · 语气 ${cfg.tone}`,
      `输入上限 ${cfg.maxInputBytes} B · 输出上限 ${cfg.maxOutputBytes} B · 命令 /${cfg.command.name} · 工具 ${cfg.tool.name}`,
      `代理引导 ${cfg.guidance.enabled ? `开（具体度 < ${cfg.guidance.threshold} 时提示使用工具）` : '关'} · 直接发送 ${cfg.allowApply ? '开' : '关'}`,
    ].join('\n'),
  },
  en: {
    title: 'Enhanced prompt',
    source: (chars, before, after) => `${chars} input chars · specificity ${before} → ${after}`,
    footer: 'To use it: paste the text above back into the composer, or run `/enhance apply <your rough request>` to send the enhanced version directly.',
    toolFooter: '(The enhanced prompt above is ready to work from; the original request is preserved inside it.)',
    usage: 'Usage: `/enhance <request>` preview; `/enhance apply <request>` preview and send; `/enhance preset <id> + <request>` switch template; `/enhance status` configuration; `/enhance help` this text.',
    empty: 'Nothing to enhance. Put the request after the command, e.g. `/enhance draft a weekly report`.',
    applied: 'Enhanced and submitted as the next message (the original request stays in the session log).',
    notApplied: '`/enhance apply` is disabled by configuration (allowApply: false); showing the preview instead.',
    engineError: {
      'empty-input': 'Empty input: put the request after the command.',
      'invalid-config': 'The enhancement configuration is invalid; check the plugin config.',
      'too-long': 'The input exceeds the configured limit; shorten it and retry.',
    },
    status: (cfg, v) => [
      `Enhanced prompt v${v}`,
      `strategy ${cfg.strategy === 'llm' ? 'model rewrite (spends tokens)' : 'offline rule engine'} · model ${cfg.llm.provider && cfg.llm.model ? `${cfg.llm.provider}/${cfg.llm.model}` : 'session default'}`,
      `preset ${cfg.preset} · language ${cfg.language} · tone ${cfg.tone}`,
      `input cap ${cfg.maxInputBytes} B · output cap ${cfg.maxOutputBytes} B · command /${cfg.command.name} · tool ${cfg.tool.name}`,
      `agent guidance ${cfg.guidance.enabled ? `on (below ${cfg.guidance.threshold} specificity)` : 'off'} · direct send ${cfg.allowApply ? 'on' : 'off'}`,
    ].join('\n'),
  },
}

const text = (zh, en) => ({ zh, en })

/**
 * Parse the `/enhance` argument grammar.
 *
 * @param {string} raw - `rawInput` from the command invocation (text after the name).
 * @returns {{ mode: 'preview'|'apply'|'status'|'help'|'error', text: string, preset?: string, language?: string, message?: string }}
 */
export function parseCommandInput(raw) {
  const input = String(raw ?? '').replace(/^\s+/, '')
  if (!input.trim()) return { mode: 'help', text: '' }
  if (/^[?？]+$/.test(input.trim())) return { mode: 'help', text: '' }
  const first = input.split(/\s+/, 1)[0].toLowerCase()
  if (['help', '-h', '--help', '?', '？'].includes(first)) return { mode: 'help', text: '' }
  if (['status', '-s', '--status'].includes(first)) return { mode: 'status', text: '' }
  if (first === 'settings' || first === 'config') return { mode: 'settings', text: '' }

  const rest = input.slice(first.length).replace(/^\s+/, '')
  if (first === 'apply' || first === 'use') return { mode: 'apply', text: rest }
  if (first === 'set' || first === 'option') return { mode: 'set', text: rest }

  if (first === 'preset' || first === 'style') {
    const [presetRaw, ...tail] = rest.split(/\s+/)
    const preset = String(presetRaw ?? '').toLowerCase()
    const body = rest.slice(String(presetRaw ?? '').length).replace(/^\s+/, '')
    if (!PRESET_IDS.includes(preset)) {
      return { mode: 'error', text: '', message: `未知预设 "${presetRaw ?? ''}"。可选：${PRESET_IDS.join(' / ')}` }
    }
    if (!body) return { mode: 'error', text: '', message: '请在预设名后写需求，例如 `/enhance preset code 帮我优化这个函数`。' }
    return { mode: 'preview', text: body, preset }
  }

  if (first === 'lang' || first === 'language') {
    const [langRaw, ...tail] = rest.split(/\s+/)
    const language = String(langRaw ?? '').toLowerCase()
    const body = rest.slice(String(langRaw ?? '').length).replace(/^\s+/, '')
    if (!LANGUAGES.includes(language)) {
      return { mode: 'error', text: '', message: `未知语言 "${langRaw ?? ''}"。可选：${LANGUAGES.join(' / ')}` }
    }
    if (!body) return { mode: 'error', text: '', message: '请在语言后写需求，例如 `/enhance lang en 帮我写周报`。' }
    return { mode: 'preview', text: body, language }
  }

  return { mode: 'preview', text: input }
}

/** Pick the message table by detection: Chinese input gets Chinese chrome. */
function tableFor(sample) {
  const s = String(sample ?? '')
  const cjk = (s.match(/[\u3400-\u9fff]/g) ?? []).length
  return cjk > 0 ? MESSAGES.zh : MESSAGES.en
}

/** Human labels for the engine's stable warning codes. */
const WARNING_LABELS = {
  zh: {
    'input-truncated': '输入过长，已按上限截断',
    'output-truncated': '输出过长，已按上限截断',
    'facts-marked-unknown': '部分信息留作「待补充」，请按需补齐',
    'preset-fallback': '模板不可用，已回退到默认模板',
    'unknown-preset': '未知模板，已回退到默认模板',
  },
  en: {
    'input-truncated': 'input truncated at the configured cap',
    'output-truncated': 'output truncated at the configured cap',
    'facts-marked-unknown': 'some facts were left as explicit placeholders',
    'preset-fallback': 'preset unavailable, fell back to the default',
    'unknown-preset': 'unknown preset, fell back to the default',
  },
}

/**
 * Render the human-facing command preview. The enhanced prompt comes first so a
 * user can copy it directly; metadata follows as a single line.
 *
 * @param {object} result - engine result.
 * @param {object} cfg - normalized plugin config.
 * @param {'command'|'tool'} [surface] - which surface renders the preview.
 * @returns {string} markdown text for the command result panel.
 */
export function renderPreview(result, cfg, surface = 'command') {
  const t = tableFor(result.original)
  const lang = result.meta?.language === 'en' ? 'en' : (result.meta?.language === 'zh' ? 'zh' : (tableFor(result.original) === MESSAGES.zh ? 'zh' : 'en'))
  const m = result.meta ?? {}
  const viaModel = m.strategy === 'llm' || m.strategy === 'rule-fallback'
  const detail = viaModel
    ? `模型 ${m.provider ?? '?'}/${m.model ?? '?'}`
      + (m.routeSource ? `（${m.routeSource === 'config' ? '配置' : '默认'}）` : '')
      + ` · ${m.elapsedMs ?? 0} ms`
      + (m.strategy === 'rule-fallback' ? ' · 已回退规则引擎' : '')
    : t.source(m.originalChars ?? 0, m.specificityBefore ?? 0, m.specificityAfter ?? 0)
      + (m.intent ? ` · ${m.intent}` : '')
      + (m.truncated ? ' · 输入已截断' : '')
  const lines = [
    `# ${t.title} · ${result.meta?.preset ?? cfg.preset} · ${m.language ?? cfg.language}`,
    '',
    result.enhanced.trim(),
    '',
    `---`,
    detail + ` · v${VERSION}`,
  ]
  if (result.warnings && result.warnings.length > 0) {
    const labels = WARNING_LABELS[lang] ?? WARNING_LABELS.en
    const shown = result.warnings.map((code) => labels[code] ?? code)
    lines.push(`${lang === 'zh' ? '注意：' : 'Note: '}${shown.join('；')}`)
  }
  lines.push(surface === 'tool' ? (t.toolFooter ?? t.footer) : t.footer)
  return lines.join('\n')
}

/** Failure copy for a surface; the tool must not talk about slash commands. */
const TOOL_ERRORS = {
  'empty-input': 'empty or blank input: pass the raw request in the "prompt" field',
  'invalid-config': 'the enhancement configuration is invalid; check the plugin config',
  'too-long': 'the input exceeds the configured byte limit',
}

/** Render the failure text shared by command and tool. */
function renderEngineError(result, surface = 'command') {
  const code = result?.error?.code ?? 'invalid-config'
  if (surface === 'tool') return TOOL_ERRORS[code] ?? result?.error?.message ?? 'enhancement failed'
  return MESSAGES.zh.engineError[code] ?? result?.error?.message ?? 'enhancement failed'
}

/**
 * Build the tool definition registered into `ctx.tools`.
 *
 * @param {object} cfg - normalized plugin config.
 * @param {{ getWorkingDirectory?: (agent: unknown) => string | undefined }} [runtime] - host facts.
 */
export function createToolDefinition(cfg, runtime = {}) {
  const toolName = cfg.tool.name
  return {
    name: toolName,
    // One model call: budget slightly above the LLM timeout so the registry
    // timeout does not fire before our own abort does.
    timeoutMs: Math.min(120000, cfg.llm.timeoutMs + 10000),
    description:
      'Rewrite a rough or vague user request into one structured, ready-to-send prompt ??role, background, '
      + 'task breakdown, output format, constraints and acceptance criteria ??then work from the rewritten prompt. '
      + 'Use it when the user asks to enhance, expand, optimize or structure a prompt, or when their request is too '
      + 'vague to execute with confidence and the work is substantial. This performs one model call and therefore '
      + 'spends tokens; it never invents facts, and missing information stays as an explicit placeholder. '
      + 'Returns the enhanced prompt plus a preview with the model route and timing.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: {
          type: 'string',
          description: "The user's raw request, as written. Do not pre-summarize it.",
        },
        preset: {
          type: 'string',
          description: `Template id: ${PRESET_IDS.join(' | ')}. Omit to use the configured default (${cfg.preset}).`,
        },
        language: {
          type: 'string',
          description: `Output language: ${LANGUAGES.join(' | ')}. Omit to auto-detect.`,
        },
        tone: {
          type: 'string',
          description: `Verbosity: ${TONES.join(' | ')}. Omit to use the configured default (${cfg.tone}).`,
        },
        maxBytes: {
          type: 'number',
          description: 'Input cap in bytes for this call, 16–60000. Input longer than the cap fails with an error instead of being truncated. Omit to use the configured cap.',
        },
      },
      required: ['prompt'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          enhanced: { type: 'string' },
          preview: { type: 'string' },
          meta: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = value ?? {}
        if (!v.ok) return [{ type: 'text', text: `Error: ${v.error || 'enhancement failed'}` }]
        return [{ type: 'text', text: v.preview || v.enhanced || '' }]
      },
    },
    async execute(args, exec) {
      const overrides = {}
      if (typeof args?.preset === 'string' && args.preset) {
        const preset = args.preset.trim().toLowerCase()
        if (PRESET_IDS.includes(preset)) overrides.preset = preset
      }
      if (typeof args?.language === 'string' && args.language) {
        const language = args.language.trim().toLowerCase()
        if (LANGUAGES.includes(language)) overrides.language = language
      }
      if (typeof args?.tone === 'string' && args.tone) {
        const tone = args.tone.trim().toLowerCase()
        if (TONES.includes(tone)) overrides.tone = tone
      }
      if (Number.isFinite(Number(args?.maxBytes))) {
        const requested = Math.trunc(Number(args.maxBytes))
        if (requested < 16 || requested > 60000) {
          return {
            ok: false,
            enhanced: '',
            preview: '',
            meta: '{}',
            error: `invalid maxBytes ${requested}: the supported range is 16–60000 bytes`,
          }
        }
        const prompt = String(args?.prompt ?? '')
        const rawBytes = new TextEncoder().encode(prompt).length
        if (rawBytes > requested) {
          return {
            ok: false,
            enhanced: '',
            preview: '',
            meta: '{}',
            error: `input is ${rawBytes} UTF-8 bytes; the requested maxBytes limit is ${requested}`,
          }
        }
        overrides.maxInputBytes = requested
      }
      const prompt = String(args?.prompt ?? '')
      if (prompt.trim().length === 0) {
        return {
          ok: false,
          enhanced: '',
          preview: '',
          meta: '{}',
          error: 'empty or blank input: pass the raw request in the "prompt" field',
        }
      }
      const liveCfg = runtime.getConfig?.() ?? cfg
      const context = collectContext(liveCfg, runtime, exec?.agent)
      const history = runtime.readHistory?.(exec?.agent?.session, liveCfg) ?? ''
      const result = await runRewrite(runtime.getLlmCtx?.() ?? {}, prompt, liveCfg, overrides, context, exec?.signal, runtime.getDefaultModel, history)
      if (!result.ok) {
        return { ok: false, enhanced: '', preview: '', meta: '{}', error: renderRewriteError(result, 'en') }
      }
      return {
        ok: true,
        enhanced: result.enhanced,
        preview: renderPreview(result, liveCfg, 'tool'),
        meta: JSON.stringify(result.meta ?? {}),
        error: '',
      }
    },
  }
}

/**
 * Flat, panel-facing view of the *effective* settings: defaults included, so the
 * settings panel always opens with real values instead of blank fields.
 *
 * @param {object} cfg - normalized config.
 * @returns {Record<string, unknown>}
 */
export function describeSettings(cfg) {
  return {
    strategy: cfg.strategy,
    style: cfg.style,
    length: cfg.length,
    language: cfg.language,
    includeHistory: cfg.history.enabled,
    historyMessages: cfg.history.messages,
    historyChars: cfg.history.chars,
    extraInstruction: cfg.extraInstruction,
    llm: {
      provider: cfg.llm.provider,
      model: cfg.llm.model,
      maxOutputTokens: cfg.llm.maxOutputTokens,
      temperature: cfg.llm.temperature,
      timeoutMs: cfg.llm.timeoutMs,
    },
  }
}

/**
 * Render the effective settings as chat-friendly text.
 *
 * @param {object} cfg - normalized config.
 * @param {string} [file] - settings file path.
 * @returns {string}
 */
export function renderSettings(cfg, file) {
  const zh = [
    `增强提示词设置（v${VERSION}）`,
    `策略 strategy      ${cfg.strategy}${cfg.strategy === 'llm' ? '（模型改写，花 token）' : '（离线规则引擎）'}`,
    `风格 style         ${cfg.style}${cfg.style === 'natural' ? '（直接给提示词正文）' : '（分节模板）'}`,
    `长度 length        ${cfg.length}`,
    `语言 language      ${cfg.language}`,
    `语气 tone          ${cfg.tone}`,
    `用会话上下文       ${cfg.history.enabled ? `开（最近 ${cfg.history.messages} 轮 / ${cfg.history.chars} 字）` : '关'}`,
    `模型 llm           ${cfg.llm.provider && cfg.llm.model ? `${cfg.llm.provider}/${cfg.llm.model}` : '跟随 profile 默认模型'}`,
    `温度 / 超时        ${cfg.llm.temperature} / ${cfg.llm.timeoutMs} ms`,
    `额外要求           ${cfg.extraInstruction || '（无）'}`,
    `设置文件           ${file ?? settingsPath()}`,
    '',
    '修改：`/enhance set style=structured length=detailed`（多个空格分隔）',
    '可选：strategy=llm|rule style=natural|structured length=short|normal|detailed',
    '      language=auto|zh|en tone=concise|standard|detailed',
    '      history=on|off historyMessages=0..20 historyChars=200..8000',
    '      provider=<id> model=<id> timeoutMs=1000..300000 temperature=0..2',
    '      extra="额外的改写要求"',
  ]
  return zh.join('\n')
}

/** Map `key=value` pairs onto a settings patch. Returns `{ patch, invalid }`. */
export function parseSettingsArguments(text) {
  const patch = {}
  const invalid = []
  const tokens = String(text ?? '').match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  for (const token of tokens) {
    const index = token.indexOf('=')
    if (index <= 0) {
      invalid.push(token)
      continue
    }
    const key = token.slice(0, index)
    let value = token.slice(index + 1)
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1)
    switch (key) {
      case 'strategy': patch.strategy = value; break
      case 'style': patch.style = value; break
      case 'length': patch.length = value; break
      case 'language':
      case 'lang': patch.language = value; break
      case 'tone': patch.tone = value; break
      case 'history': patch.includeHistory = value === 'on' || value === 'true' || value === '1'; break
      case 'historyMessages': patch.historyMessages = Number(value); break
      case 'historyChars': patch.historyChars = Number(value); break
      case 'extra': patch.extraInstruction = value; break
      case 'provider':
      case 'model':
      case 'timeoutMs':
      case 'temperature':
      case 'maxOutputTokens':
        patch.llm = { ...(patch.llm ?? {}), [key]: key === 'provider' || key === 'model' ? value : Number(value) }
        break
      default:
        invalid.push(token)
    }
  }
  return { patch, invalid }
}

/**
 * Build one identified user message for `agent.steer()`.
 *
 * `UserMessage` requires an identity and a role: the inbox dedupes pending input
 * by `message.id`, and the durable `user/message` event carries that id. The
 * first-party producers construct the same shape through `createUserMessage()`
 * (`@deepseek-ai/dsh-llm`), whose `brandString()` is the identity function at
 * runtime, so a plain UUID plus `role: 'user'` is the complete wire shape.
 */
function createUserMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'enhanced-prompt' },
  }
}

/**
 * Build the command definition registered into `ctx.commands`.
 *
 * @param {object} cfg - normalized plugin config.
 * @param {{ getWorkingDirectory?: (agent: unknown) => string | undefined }} [runtime] - host facts.
 */
export function createCommandDefinition(cfg, runtime = {}) {
  return {
    name: cfg.command.name,
    description: '把粗略需求展开成结构化提示词（增强提示词）| Expand a rough request into a structured prompt',
    input: { hint: '<粗提示词> | apply <粗提示词> | preset <id> <粗提示词> | status | settings | set key=value | help' },
    handler: async (invocation) => {
      const parsed = parseCommandInput(invocation?.rawInput ?? '')
      const liveCfg = runtime.getConfig?.() ?? cfg
      if (parsed.mode === 'help') return { kind: 'success', text: MESSAGES.zh.usage + '\n\n' + MESSAGES.en.usage }
      if (parsed.mode === 'status') {
        return { kind: 'success', text: MESSAGES.zh.status(liveCfg, VERSION) + '\n' + MESSAGES.en.status(liveCfg, VERSION) }
      }
      if (parsed.mode === 'settings') return { kind: 'success', text: renderSettings(liveCfg) }
      if (parsed.mode === 'set') {
        const { patch, invalid } = parseSettingsArguments(parsed.text)
        if (invalid.length > 0) return { kind: 'error', text: `无法识别的设置：${invalid.join(' ')}` }
        if (Object.keys(patch).length === 0) return { kind: 'error', text: '用法：`/enhance set style=structured length=short`' }
        if (typeof runtime.saveSettings !== 'function') {
          return { kind: 'error', text: '当前构建不支持写入设置；请改 profile 的 cordis.patch.yml。' }
        }
        try {
          runtime.saveSettings(patch)
        } catch (error) {
          return { kind: 'error', text: `保存设置失败：${error && error.message ? error.message : String(error)}` }
        }
        return { kind: 'success', text: '已保存。\n\n' + renderSettings(runtime.getConfig?.() ?? cfg) }
      }
      if (parsed.mode === 'error') return { kind: 'error', text: parsed.message ?? 'invalid arguments' }
      if (!parsed.text.trim()) return { kind: 'error', text: MESSAGES.zh.empty + '\n' + MESSAGES.en.empty }

      const overrides = {}
      if (parsed.preset) overrides.preset = parsed.preset
      if (parsed.language) overrides.language = parsed.language
      const context = collectContext(liveCfg, runtime, invocation?.agent)
      const history = runtime.readHistory?.(invocation?.agent?.session, liveCfg) ?? ''
      const result = await runRewrite(runtime.getLlmCtx?.() ?? {}, parsed.text, liveCfg, overrides, context, invocation?.signal, runtime.getDefaultModel, history)
      if (!result.ok) return { kind: 'error', text: renderRewriteError(result, 'zh') }
      const preview = renderPreview(result, liveCfg)

      if (parsed.mode === 'apply') {
        if (!cfg.allowApply) return { kind: 'success', text: preview + '\n\n' + MESSAGES.zh.notApplied }
        const agent = invocation?.agent
        if (!agent || typeof agent.steer !== 'function') {
          return { kind: 'error', text: '当前会话没有可用的 agent，无法直接发送增强结果；已生成预览。\n' + preview }
        }
        try {
          await agent.steer(createUserMessage(result.enhanced))
        } catch (error) {
          return {
            kind: 'error',
            text: `发送增强结果失败：${error && error.message ? error.message : String(error)}\n${preview}`,
          }
        }
        return { kind: 'success', text: MESSAGES.zh.applied + '\n\n' + preview }
      }

      return { kind: 'success', text: preview }
    },
  }
}

/** Static guidance text contributed to the system prompt (no interpolation). */
export function guidanceText(cfg) {
  return [
    '## Enhanced prompt',
    `The \`${cfg.tool.name}\` tool rewrites a rough request into a structured prompt with one model call`,
    '(it spends tokens). It never invents facts: anything the user did not say stays as an explicit',
    'placeholder. Its result is ready to work from, so do not re-summarize it.',
    '',
    `Call \`${cfg.tool.name}\` when the user explicitly asks to enhance/expand/structure a prompt, or when their`,
    `message is a short, underspecified request (specificity below ${cfg.guidance.threshold}/100) for work that will`,
    'take several steps. Then continue from the structured prompt instead of the original wording.',
    'Do not call it for greetings, confirmations, or requests that are already precise. Do not present the',
    'enhancement as the answer by itself: either proceed with the work or ask the user to confirm the restated goal',
    'when a choice is genuinely theirs. Keep placeholders visible rather than guessing.',
    `Humans can run \`/${cfg.command.name}\` themselves; \`/${cfg.command.name} apply <request>\` sends the enhanced version directly.`,
  ].join('\n')
}

/**
 * Cordis plugin entry point.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin's Cordis context.
 * @param {unknown} config - the loader row `config`.
 */
export function apply(ctx, config) {
  const { config: cfg, warnings } = normalizeConfigResult(config)
  const configWarnings = warnings
  const rawRowConfig = config
  if (!cfg.enabled) {
    if (cfg.diagnostics) console.log('[enhanced-prompt] disabled by config; no capability registered')
    return
  }

  /** User overrides, editable at runtime from the panel or `/enhance set`. */
  let savedSettings = readSettings()
  /** Effective config: profile patch + saved overrides, always re-validated. */
  let effectiveCfg = normalizeConfigResult(mergeSettings(rawRowConfig, savedSettings)).config
  const getConfig = () => effectiveCfg
  const saveSettings = (patch) => {
    savedSettings = writeSettings({ ...savedSettings, ...patch })
    effectiveCfg = normalizeConfigResult(mergeSettings(rawRowConfig, savedSettings)).config
    return savedSettings
  }

  const log = (message) => {
    if (cfg.diagnostics) console.log(`[enhanced-prompt] ${message}`)
  }

  // Session-scoped working directory through the Host service; the process cwd
  // of a Desktop Host is the profile directory and must never become model text.
  /** Filled once the optional default-model service activates. */
  let defaultModelService
  ctx.inject(['agentDefaultModel'], (serviceScope) => {
    try {
      defaultModelService = serviceScope.agentDefaultModel
    } catch {
      /* stay unresolved; the caller reports it */
    }
  })

  /** `ctx.llm` is only readable inside a context that declares the inject. */
  let llmScope
  ctx.inject(['llm'], (serviceScope) => {
    llmScope = serviceScope
  })

  /** Session history comes from the Host's own model-visible projection. */
  let sessionsService
  ctx.inject(['sessions'], (serviceScope) => {
    try {
      sessionsService = serviceScope.sessions
    } catch {
      /* history simply stays empty */
    }
  })

  const runtime = {
    ctx,
    getConfig,
    getSettings: () => savedSettings,
    saveSettings,
    getDefaultModel: () => defaultModelService,
    /** Minimal facade: the only Host service the rewriter touches. */
    getLlmCtx: () => (llmScope ? { llm: llmScope.llm } : undefined),
    /** Render the conversation tail for the rewrite, capped by config. */
    readHistory: (sessionOrId, liveCfg) => {
      const settings = liveCfg ?? getConfig()
      if (!settings.history?.enabled) return ''
      const session = resolveSession(sessionOrId)
      if (!session || typeof session.deriveMessages !== 'function') return ''
      try {
        const turns = recentTurns(session.deriveMessages(), {
          maxMessages: settings.history.messages,
          maxChars: settings.history.chars,
        })
        const language = settings.language === 'en' ? 'en' : 'zh'
        return renderHistory(turns, language)
      } catch {
        return ''
      }
    },
    getWorkingDirectory: (agent) => {
      try {
        const service = typeof ctx.get === 'function' ? ctx.get('workingDirectory', false) : undefined
        return service && typeof service.get === 'function' ? service.get(agent?.session) : undefined
      } catch {
        return undefined
      }
    },
  }

  /** Accept a Session object, a session id string, or an object carrying one. */
  function resolveSession(candidate) {
    if (!candidate) return undefined
    if (typeof candidate === 'object' && typeof candidate.deriveMessages === 'function') return candidate
    const id = typeof candidate === 'string' ? candidate : candidate?.id ?? candidate?.sessionId
    if (typeof id !== 'string' || id.length === 0 || !sessionsService) return undefined
    try {
      return sessionsService.get(id) ?? undefined
    } catch {
      return undefined
    }
  }

  /** Route shown in logs and `/enhance status`; resolved lazily because the
   *  default-model service may activate after this plugin. */
  const describeRoute = () => resolveRoute(ctx, cfg.llm, runtime.getDefaultModel) ?? undefined

  if (cfg.command.enabled) {
    ctx.inject(['commands'], (scope) => {
      try {
        scope.commands.register(createCommandDefinition(cfg, runtime))
        log(`registered command /${cfg.command.name}`)
      } catch (error) {
        log(`command registration failed: ${error && error.message ? error.message : String(error)}`)
      }
    })
  }
  if (cfg.tool.enabled) {
    ctx.inject(['tools'], (scope) => {
      try {
        scope.tools.register(createToolDefinition(cfg, runtime))
        log(`registered tool ${cfg.tool.name}`)
      } catch (error) {
        log(`tool registration failed: ${error && error.message ? error.message : String(error)}`)
      }
    })
  }
  if (cfg.guidance.enabled) {
    ctx.inject(['systemPrompt'], (scope) => {
      try {
        scope.systemPrompt.section({
          name: 'enhanced-prompt:guidance',
          order: cfg.guidance.order,
          interpolate: false,
          text: () => guidanceText(cfg),
        })
        log(`registered prompt section enhanced-prompt:guidance at order ${cfg.guidance.order}`)
      } catch (error) {
        log(`prompt section registration failed: ${error && error.message ? error.message : String(error)}`)
      }
    })
  }

  if (cfg.bridge.enabled) {
    ctx.inject(['webServer', 'llm'], (scope) => {
      try {
        const handler = createBridgeHandler({
          version: VERSION,
          strategy: cfg.strategy,
          maxInputCharacters: cfg.maxInputCharacters,
          maxInFlight: cfg.bridge.maxInFlight,
          describeRoute,
          getConfig,
          getSettings: () => savedSettings,
          /** Panel view: effective values (defaults included), not just overrides. */
          describeSettings: () => describeSettings(getConfig()),
          saveSettings,
          enhance: async (request) => {
            const liveCfg = getConfig()
            const context = collectContext(liveCfg, runtime, undefined)
            const history = runtime.readHistory(request.sessionId, liveCfg)
            const result = await runRewrite(runtime.getLlmCtx?.() ?? {}, request.text, liveCfg, {
              preset: request.preset,
              language: request.language,
              tone: request.tone,
            }, context, request.signal, runtime.getDefaultModel, history)
            if (!result.ok) {
              const error = new Error(result.error?.message ?? 'rewrite failed')
              error.code = result.error?.code ?? 'provider-error'
              throw error
            }
            return {
              enhanced: result.enhanced,
              provider: result.meta?.provider,
              model: result.meta?.model,
              routeSource: result.meta?.routeSource,
              historyChars: history.length,
            }
          },
        })
        scope.effect(() => registerBridge(scope, { path: BRIDGE_PATH, handler }), 'enhanced-prompt: bridge')
        log(`registered bridge POST ${BRIDGE_PATH}`)
      } catch (error) {
        log(`bridge registration failed: ${error && error.message ? error.message : String(error)}`)
      }
    })
  }

  log(
    `activated v${VERSION} strategy=${getConfig().strategy} style=${getConfig().style}/${getConfig().length} `
    + `route=${(() => {
      const route = describeRoute()
      return route ? `${route.provider}/${route.model}(${route.source})` : 'unresolved'
    })()} preset=${getConfig().preset} lang=${getConfig().language} caps=${getConfig().maxInputBytes}/${getConfig().maxOutputBytes}B `
    + `history=${getConfig().history.enabled ? `on(${getConfig().history.messages}/${getConfig().history.chars})` : 'off'} `
    + `command=${cfg.command.enabled ? 'on' : 'off'} tool=${cfg.tool.enabled ? 'on' : 'off'} `
    + `guidance=${cfg.guidance.enabled ? `on@${cfg.guidance.order}<${cfg.guidance.threshold}` : 'off'} `
    + `bridge=${cfg.bridge.enabled ? BRIDGE_PATH : 'off'} `
    + `settings=${settingsPath()}`
    + (configWarnings.length > 0 ? ` configWarnings=${JSON.stringify(configWarnings)}` : ''),
  )
}
