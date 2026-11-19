/**
 * Preset definitions and selection rules for the enhanced-prompt engine.
 *
 * Section copy and filler heuristics live in `preset-copy.js`; this module owns
 * the preset registry, the auto-selection rules, and the serializable metadata
 * the Host renders in its preview UI.
 *
 * The `six-section` preset is adopted from public human-facing prompt-writing
 * guidance; it is not a vendor output schema. The default rewrite template is
 * `standard` (role-first, background-aware).
 *
 * @module presets
 */

import { FILLERS, PLACEHOLDER_EN, PLACEHOLDER_ZH, placeholder, section } from './preset-copy.js';

/**
 * @typedef {'zh' | 'en'} RenderLanguage
 * @typedef {'concise' | 'standard' | 'detailed'} Tone
 * @typedef {{ cwd?: string, workspace?: string, date?: string, goal?: string, files?: string[] }} EngineContext
 * @typedef {import('./preset-copy.js').SectionDefinition} SectionDefinition
 * @typedef {Object} PresetDefinition
 * @property {string} id
 * @property {string} labelZh
 * @property {string} labelEn
 * @property {string} descriptionZh
 * @property {string} descriptionEn
 * @property {'sections' | 'compact'} format
 * @property {SectionDefinition[]} sections
 */

/** Default preset id used when `auto` mode has no confident intent. @type {string} */
export const DEFAULT_PRESET = 'standard';

/** Confidence threshold for selecting a non-default preset in `auto` mode. @type {number} */
export const AUTO_CONFIDENCE_THRESHOLD = 0.6;

/** Preset ids in display order; `auto` is a sentinel, not a real preset. @type {string[]} */
export const PRESET_IDS = ['auto', 'standard', 'six-section', 'goal-oriented', 'concise', 'code'];

/** Confident intents that beat the default preset in `auto` mode. */
const AUTO_INTENT_PRESET = { code: 'code', writing: 'goal-oriented', planning: 'goal-oriented', data: 'goal-oriented' };

/** Chinese placeholder rendered where a fact is genuinely unknown. @type {string} */
export { PLACEHOLDER_ZH };

/** English placeholder rendered where a fact is genuinely unknown. @type {string} */
export { PLACEHOLDER_EN };

/** Placeholder text for a rendering language. @type {(lang: RenderLanguage | string) => string} */
export { placeholder };

/** All presets keyed by id. @type {Record<string, PresetDefinition>} */
export const PRESETS = {
  standard: {
    id: 'standard',
    labelZh: '标准改写',
    labelEn: 'Standard rewrite',
    descriptionZh: '角色先行、背景驱动的通用模板，适合大多数模糊需求，也是自动模式的默认选择。',
    descriptionEn: 'Role-first, background-aware template for most vague requests; the default in auto mode.',
    format: 'sections',
    sections: [
      section('role', FILLERS.roleBody),
      section('background', FILLERS.backgroundBody),
      section('task-breakdown', FILLERS.actionsBody),
      section('output-format', FILLERS.formatBody),
      section('constraints', FILLERS.constraints),
      section('acceptance', FILLERS.acceptance),
    ],
  },
  'six-section': {
    id: 'six-section',
    labelZh: '六段式模板',
    labelEn: 'Six-section template',
    descriptionZh: '目标 / 输入 / 动作 / 约束 / 输出 / 验收 的通用写作模板，改编自公开的人用提示词写作指南。',
    descriptionEn: 'Goal / Input / Actions / Constraints / Output / Acceptance template, adapted from public human-facing prompt-writing guidance.',
    format: 'sections',
    sections: [
      section('goal', FILLERS.goalBody),
      section('input', FILLERS.inputBody),
      section('actions', FILLERS.actionsBody),
      section('constraints', FILLERS.constraints),
      section('output', FILLERS.formatBody),
      section('acceptance', FILLERS.acceptance, { titleZh: '验收', titleEn: 'Acceptance' }),
    ],
  },
  'goal-oriented': {
    id: 'goal-oriented',
    labelZh: '目标导向模板',
    labelEn: 'Goal-oriented template',
    descriptionZh: '先锁定目标，再补背景、交付物、约束与成功标准，适合有明确产出的任务。',
    descriptionEn: 'Locks the goal first, then adds context, deliverable, constraints, and success criteria; suits tasks with a clear output.',
    format: 'sections',
    sections: [
      section('goal', FILLERS.goalBody),
      section('context', FILLERS.backgroundBody),
      section('deliverable', FILLERS.formatBody),
      section('constraints', FILLERS.constraints),
      section('success-criteria', FILLERS.acceptance),
    ],
  },
  concise: {
    id: 'concise',
    labelZh: '精简三行',
    labelEn: 'Concise three-liner',
    descriptionZh: '压成三行：目标、动作、输出，适合快速改写一句话需求。',
    descriptionEn: 'Three lines only: goal, actions, output; best for quickly rewriting a one-line request.',
    format: 'compact',
    sections: [section('goal', FILLERS.compactGoal), section('actions', FILLERS.compactActions), section('output', FILLERS.compactOutput)],
  },
  code: {
    id: 'code',
    labelZh: '代码任务',
    labelEn: 'Code task',
    descriptionZh: '角色、任务、约束、验收四段，面向代码实现与排障类需求。',
    descriptionEn: 'Role, task, constraints, and acceptance for implementation and debugging requests.',
    format: 'sections',
    sections: [
      section('role', FILLERS.codeRoleBody),
      section('task', FILLERS.taskBody),
      section('constraints', FILLERS.codeConstraints),
      section('acceptance', FILLERS.codeAcceptance),
    ],
  },
};

/**
 * Look up a real preset by id; `auto` resolves to null because it is only a
 * selection mode, never an output schema.
 * @param {string} id preset id
 * @returns {PresetDefinition | null} preset or null when unknown
 */
export function getPreset(id) {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(PRESETS, id)) return null;
  return PRESETS[id];
}

/**
 * Resolve the preset id to render, honoring an explicit id before `auto`.
 * In `auto` mode a confident intent may override the default preset.
 * @param {{ preset?: string, intent?: string, confidence?: number }} [options] selection inputs
 * @returns {{ id: string, presetSource: 'explicit' | 'auto', strategy: 'explicit' | 'auto-intent' | 'auto-default', warning?: string }} resolution
 */
export function selectPreset(options = {}) {
  const preset = typeof options.preset === 'string' ? options.preset.trim() : 'auto';
  const intent = typeof options.intent === 'string' ? options.intent : 'other';
  const confidence = typeof options.confidence === 'number' && Number.isFinite(options.confidence) ? options.confidence : 0;
  const explicit = getPreset(preset);
  if (explicit) return { id: explicit.id, presetSource: 'explicit', strategy: 'explicit' };
  const isAuto = preset === '' || preset === 'auto';
  const warning = isAuto ? undefined : 'preset-fallback';
  const mapped = confidence >= AUTO_CONFIDENCE_THRESHOLD ? AUTO_INTENT_PRESET[intent] : undefined;
  if (mapped && getPreset(mapped)) return { id: mapped, presetSource: 'auto', strategy: 'auto-intent', warning };
  return { id: DEFAULT_PRESET, presetSource: 'auto', strategy: 'auto-default', warning };
}

/**
 * Serialize preset metadata (no filler functions) for the Host preview UI.
 * @returns {Array<{ id: string, labelZh: string, labelEn: string, descriptionZh: string, descriptionEn: string, format: string, sections: Array<{ key: string, titleZh: string, titleEn: string, guidanceZh: string, guidanceEn: string }> }>} preset metadata
 */
export function describePresets() {
  return PRESET_IDS
    .filter((id) => Object.prototype.hasOwnProperty.call(PRESETS, id))
    .map((id) => {
      const preset = PRESETS[id];
      return {
        id: preset.id,
        labelZh: preset.labelZh,
        labelEn: preset.labelEn,
        descriptionZh: preset.descriptionZh,
        descriptionEn: preset.descriptionEn,
        format: preset.format,
        sections: preset.sections.map(({ key, titleZh, titleEn, guidanceZh, guidanceEn }) => ({ key, titleZh, titleEn, guidanceZh, guidanceEn })),
      };
    });
}
