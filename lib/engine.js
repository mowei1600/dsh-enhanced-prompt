/**
 * Deterministic prompt-enhancement engine.
 *
 * `enhance(raw, config)` expands a vague request into a structured, ready-to-
 * send prompt. It is pure and offline: no file-system access, no clock, no
 * randomness, no network, and no third-party dependency. The Host is
 * responsible for measuring `elapsedMs` and persisting settings.
 *
 * @module engine
 */

import {
  DEFAULT_MAX_INPUT_BYTES,
  classifyIntent,
  countScripts,
  detectLanguage,
  normalizeInput,
  scoreSpecificity,
  stripZeroWidth,
  truncateToBytes,
  utf8Length,
} from './analysis.js';
import {
  DEFAULT_PRESET,
  PLACEHOLDER_EN,
  PLACEHOLDER_ZH,
  getPreset,
  placeholder,
  selectPreset,
} from './presets.js';

/**
 * @typedef {'concise' | 'standard' | 'detailed'} Tone
 * @typedef {Object} EngineContext
 * @property {string} [cwd]
 * @property {string} [workspace]
 * @property {string} [date]
 * @property {string} [goal]
 * @property {string[]} [files]
 * @typedef {Object} EngineConfig
 * @property {string} preset preset id or 'auto'
 * @property {'auto' | 'zh' | 'en'} language
 * @property {number} maxInputBytes
 * @property {number} maxOutputBytes
 * @property {boolean} includeOriginal
 * @property {Tone} tone
 * @property {EngineContext} context
 * @typedef {Object} EngineSection
 * @property {string} key
 * @property {string} title
 * @property {string} body
 * @typedef {Object} EngineMeta
 * @property {string} preset resolved preset id (never 'auto')
 * @property {'explicit' | 'auto'} presetSource how the preset was chosen
 * @property {'zh' | 'en'} language rendering language
 * @property {'zh' | 'en' | 'mixed'} detectedLanguage detected input language
 * @property {string} intent classified intent
 * @property {number} intentConfidence 0-1
 * @property {number} specificityBefore 0-100
 * @property {number} specificityAfter 0-100
 * @property {number} originalChars characters of the cleaned input before capping
 * @property {number} enhancedChars characters of the rendered prompt
 * @property {boolean} truncated input or output was byte-capped
 * @property {string} strategy selection rationale
 * @property {boolean} originalPreserved original text block is present in the output
 * @property {number} elapsedMs always 0; measured by the caller
 * @typedef {Object} EnhanceSuccess
 * @property {true} ok
 * @property {string} original normalized input text
 * @property {string} enhanced full ready-to-send markdown prompt
 * @property {EngineSection[]} sections ordered sections
 * @property {EngineMeta} meta
 * @property {string[]} warnings warning codes
 * @typedef {Object} EnhanceFailure
 * @property {false} ok
 * @property {{ code: 'empty-input' | 'too-long' | 'invalid-config', message: string }} error
 */

/** Hard ceiling on raw input, in UTF-8 bytes; larger requests are rejected. @type {number} */
export const HARD_INPUT_BYTES = 262144;

/** All warning codes the engine can emit. @type {string[]} */
export const WARNING_CODES = Object.freeze([
  'input-truncated',
  'output-truncated',
  'facts-marked-unknown',
  'preset-fallback',
]);

/** Engine defaults, also used when `config` is omitted. @type {Readonly<EngineConfig>} */
export const DEFAULT_CONFIG = Object.freeze({
  preset: 'auto',
  language: 'auto',
  maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
  maxOutputBytes: 16000,
  includeOriginal: false,
  tone: 'standard',
  context: Object.freeze({}),
});

const TONES = ['concise', 'standard', 'detailed'];
const LANGUAGES = ['auto', 'zh', 'en'];
const MIN_INPUT_BYTES = 16;
const MIN_OUTPUT_BYTES = 256;
const MAX_OUTPUT_BYTES = 1000000;
const MAX_CONTEXT_FILES = 20;
const MAX_CONTEXT_CHARS = 200;

/**
 * Normalize a caller-supplied config object against the engine defaults.
 * Invalid field values fall back to the default silently; a non-object config
 * is rejected with `invalid-config`. The `warnings` array is reserved for
 * result-level codes and is always empty here.
 * @param {unknown} config caller config
 * @returns {{ ok: true, config: EngineConfig, warnings: string[] } | { ok: false, error: { code: 'invalid-config', message: string } }} normalized config
 */
export function normalizeConfig(config) {
  if (config === undefined || config === null) return { ok: true, config: defaultConfig(), warnings: [] };
  if (typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, error: { code: 'invalid-config', message: 'config must be a plain object' } };
  }
  const output = defaultConfig();
  const has = (key) => Object.prototype.hasOwnProperty.call(config, key);
  if (has('preset')) {
    if (typeof config.preset === 'string' && config.preset.trim() !== '') output.preset = config.preset.trim();
  }
  if (has('language')) {
    if (LANGUAGES.includes(config.language)) output.language = config.language;
  }
  if (has('maxInputBytes')) {
    const value = config.maxInputBytes;
    if (typeof value === 'number' && Number.isFinite(value)) {
      output.maxInputBytes = Math.min(HARD_INPUT_BYTES, Math.max(MIN_INPUT_BYTES, Math.floor(value)));
    }
  }
  if (has('maxOutputBytes')) {
    const value = config.maxOutputBytes;
    if (typeof value === 'number' && Number.isFinite(value)) {
      output.maxOutputBytes = Math.min(MAX_OUTPUT_BYTES, Math.max(MIN_OUTPUT_BYTES, Math.floor(value)));
    }
  }
  if (has('includeOriginal') && typeof config.includeOriginal === 'boolean') {
    output.includeOriginal = config.includeOriginal;
  }
  if (has('tone') && TONES.includes(config.tone)) output.tone = config.tone;
  if (has('context') && config.context !== undefined && config.context !== null) {
    if (typeof config.context === 'object' && !Array.isArray(config.context)) {
      output.context = sanitizeContext(config.context);
    }
  }
  return { ok: true, config: output, warnings: [] };
}

/**
 * Expand a vague request into a structured, ready-to-send prompt.
 *
 * The result is fully deterministic: identical `(raw, config)` inputs always
 * produce byte-identical output. Unknown facts are rendered as explicit
 * placeholders; nothing is invented.
 * @param {string} raw user input
 * @param {EngineConfig | Object} [config] optional settings; invalid fields fall back
 * @returns {EnhanceSuccess | EnhanceFailure} enhanced prompt or a coded error
 */
export function enhance(raw, config = {}) {
  const normalized = normalizeConfig(config);
  if (!normalized.ok) return normalized;
  const settings = normalized.config;
  const warnings = [...normalized.warnings];

  if (typeof raw !== 'string') return failure('empty-input', 'input must be a non-empty string');
  const rawBytes = utf8Length(raw);
  if (rawBytes > HARD_INPUT_BYTES) {
    return failure('too-long', `input is ${rawBytes} UTF-8 bytes; the hard limit is ${HARD_INPUT_BYTES}`);
  }
  const input = normalizeInput(raw, { maxInputBytes: settings.maxInputBytes });
  if (!input.ok) return failure('empty-input', 'input is empty after normalization');
  if (input.truncated) warnings.push('input-truncated');

  const detectedLanguage = detectLanguage(input.text);
  const language = resolveRenderLanguage(settings.language, detectedLanguage, input.text);
  const intent = classifyIntent(input.text);
  const selection = selectPreset({ preset: settings.preset, intent: intent.intent, confidence: intent.confidence });
  if (selection.warning) warnings.push(selection.warning);
  const preset = getPreset(selection.id) ?? getPreset(DEFAULT_PRESET);
  if (!preset) return failure('invalid-config', 'no usable preset definition was found');

  const sectionContext = {
    text: input.text,
    lang: language,
    inputLanguage: detectedLanguage,
    intent: intent.intent,
    tone: settings.tone,
    context: settings.context,
    includeOriginal: settings.includeOriginal,
  };
  const sections = preset.sections.map((definition) => {
    const filled = String(definition.fill(sectionContext) ?? '').trim();
    return {
      key: definition.key,
      title: language === 'zh' ? definition.titleZh : definition.titleEn,
      body: filled || placeholder(language),
    };
  });

  const before = scoreSpecificity(input.text);
  const originalBlockText = originalBlock(language, input.text, preset.format === 'compact');
  let enhanced = composeOutput({
    preset,
    sections,
    language,
    includeOriginal: settings.includeOriginal,
    originalBlockText,
  });
  let truncated = input.truncated;
  const capped = truncateToBytes(enhanced, settings.maxOutputBytes);
  if (capped.truncated) {
    enhanced = capped.text;
    truncated = true;
    warnings.push('output-truncated');
  }
  if (enhanced.includes(PLACEHOLDER_ZH) || enhanced.includes(PLACEHOLDER_EN)) warnings.push('facts-marked-unknown');
  const after = scoreSpecificity(enhanced);

  const meta = {
    preset: preset.id,
    presetSource: selection.presetSource,
    language,
    detectedLanguage,
    intent: intent.intent,
    intentConfidence: intent.confidence,
    specificityBefore: before.score,
    specificityAfter: after.score,
    originalChars: input.originalChars,
    enhancedChars: [...enhanced].length,
    truncated,
    strategy: selection.strategy,
    originalPreserved: settings.includeOriginal && enhanced.includes(originalBlockText),
    elapsedMs: 0,
  };

  return { ok: true, original: input.text, enhanced, sections, meta, warnings: dedupe(warnings) };
}

/**
 * Preset ids including the `auto` sentinel, in display order.
 * @type {string[]}
 */
export { PRESET_IDS } from './presets.js';

/**
 * Serializable preset metadata for the Host preview UI.
 * @type {() => Array<{ id: string, labelZh: string, labelEn: string, descriptionZh: string, descriptionEn: string, format: string, sections: Array<{ key: string, titleZh: string, titleEn: string, guidanceZh: string, guidanceEn: string }> }>}
 */
export { describePresets } from './presets.js';

/**
 * Create a fresh default config object.
 * @returns {EngineConfig} mutable default config
 */
function defaultConfig() {
  return {
    preset: 'auto',
    language: 'auto',
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: 16000,
    includeOriginal: false,
    tone: 'standard',
    context: {},
  };
}

/**
 * Build a coded failure result.
 * @param {'empty-input' | 'too-long' | 'invalid-config'} code error code
 * @param {string} message human-readable message
 * @returns {EnhanceFailure} failure result
 */
function failure(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * Remove duplicate warning codes while keeping first-seen order.
 * @param {string[]} warnings warning codes
 * @returns {string[]} deduplicated codes
 */
function dedupe(warnings) {
  return [...new Set(warnings)];
}

/**
 * Pick the language used for rendering: an explicit config value wins, then
 * a clear detection, then the majority script for mixed input.
 * @param {'auto' | 'zh' | 'en'} configured configured language
 * @param {'zh' | 'en' | 'mixed'} detected detected language
 * @param {string} text normalized input
 * @returns {'zh' | 'en'} rendering language
 */
function resolveRenderLanguage(configured, detected, text) {
  if (configured === 'zh' || configured === 'en') return configured;
  if (detected === 'zh' || detected === 'en') return detected;
  const { cjk, latin } = countScripts(text);
  return cjk >= latin ? 'zh' : 'en';
}

/**
 * Render the optional original-request block. Multi-line input becomes a
 * blockquote; compact presets keep it on a single line.
 * @param {'zh' | 'en'} language rendering language
 * @param {string} text normalized input
 * @param {boolean} compact whether the preset uses compact rendering
 * @returns {string} markdown block
 */
function originalBlock(language, text, compact) {
  const label = language === 'zh' ? '原始请求' : 'Original request';
  const colon = language === 'zh' ? '：' : ': ';
  if (compact) return `${label}${colon}${text.replace(/\s+/g, ' ').trim()}`;
  const lines = text.split('\n');
  const head = `> ${label}${colon}${lines[0]}`;
  const rest = lines.slice(1).map((line) => `> ${line}`).join('\n');
  return rest ? `${head}\n${rest}` : head;
}

/**
 * Assemble the final markdown prompt from ordered sections.
 * @param {{ preset: { format: 'sections' | 'compact' }, sections: EngineSection[], language: 'zh' | 'en', includeOriginal: boolean, originalBlockText: string }} input composition inputs
 * @returns {string} assembled prompt
 */
function composeOutput(input) {
  const { preset, sections, language, includeOriginal, originalBlockText } = input;
  const parts = [];
  if (includeOriginal) parts.push(originalBlockText);
  if (preset.format === 'compact') {
    const colon = language === 'zh' ? '：' : ': ';
    const joiner = language === 'zh' ? '；' : '; ';
    for (const section of sections) {
      parts.push(`${section.title}${colon}${section.body.replace(/\s*\n+\s*/g, joiner).trim()}`);
    }
    return parts.join('\n');
  }
  for (const section of sections) parts.push(`## ${section.title}\n${section.body}`);
  return parts.join('\n\n');
}

/**
 * Trim and clip a caller-supplied context string.
 * @param {unknown} value raw value
 * @returns {string} cleaned value or ''
 */
function cleanScalar(value) {
  if (typeof value !== 'string') return '';
  return clipChars(stripZeroWidth(value).replace(/\s+/g, ' ').trim(), MAX_CONTEXT_CHARS);
}

/**
 * Keep only the known, non-empty context fields.
 * @param {Record<string, unknown>} raw caller context
 * @returns {EngineContext} sanitized context
 */
function sanitizeContext(raw) {
  const context = {};
  for (const key of ['cwd', 'workspace', 'date', 'goal']) {
    const value = cleanScalar(raw[key]);
    if (value) context[key] = value;
  }
  if (Array.isArray(raw.files)) {
    const files = raw.files.map((file) => cleanScalar(file)).filter((file) => file !== '').slice(0, MAX_CONTEXT_FILES);
    if (files.length > 0) context.files = files;
  }
  return context;
}

/**
 * Clip a string to a code-point budget.
 * @param {string} value text
 * @param {number} max budget
 * @returns {string} clipped text
 */
function clipChars(value, max) {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join('');
}
