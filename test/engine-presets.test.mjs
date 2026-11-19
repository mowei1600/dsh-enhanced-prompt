import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PRESET_IDS, describePresets, enhance } from '../lib/engine.js';
import {
  PLACEHOLDER_ZH,
  PRESET_IDS as PRESET_IDS_FROM_PRESETS,
  describePresets as describePresetsFromPresets,
  getPreset,
  selectPreset,
} from '../lib/presets.js';

const VAGUE_ZH = '帮我弄一下这个东西';
const CODE_ZH = '用 TypeScript 写一个防抖函数，并补充单元测试和错误处理';

test('auto mode promotes a confident intent to a matching preset', () => {
  const code = enhance(CODE_ZH);
  assert.equal(code.meta.intent, 'code');
  assert.ok(code.meta.intentConfidence >= 0.6);
  assert.equal(code.meta.preset, 'code');
  assert.equal(code.meta.presetSource, 'auto');
  assert.equal(code.meta.strategy, 'auto-intent');
  assert.deepEqual(code.sections.map((section) => section.title), ['角色', '任务', '约束', '验收标准']);

  const writing = enhance('帮我写一篇公众号文章，主题是远程办公，风格正式');
  assert.equal(writing.meta.intent, 'writing');
  assert.ok(writing.meta.intentConfidence >= 0.6);
  assert.equal(writing.meta.preset, 'goal-oriented');
  assert.deepEqual(writing.sections.map((section) => section.title), ['目标', '背景', '交付物', '约束', '成功标准']);

  const data = enhance('分析这份销售数据，给出转化率指标和图表');
  assert.equal(data.meta.intent, 'data');
  assert.equal(data.meta.preset, 'goal-oriented');
});

test('standard is the default preset when no intent is confident', () => {
  const result = enhance(VAGUE_ZH);
  assert.equal(result.meta.preset, 'standard');
  assert.equal(result.meta.presetSource, 'auto');
  assert.equal(result.meta.strategy, 'auto-default');
  assert.notEqual(result.meta.preset, 'auto');
  assert.deepEqual(result.sections.map((section) => section.title), ['角色', '背景', '任务拆解', '输出格式', '约束', '验收标准']);
});

test('all five presets render with the documented section counts', () => {
  const expected = {
    standard: { count: 6, first: '角色' },
    'six-section': { count: 6, first: '目标' },
    'goal-oriented': { count: 5, first: '目标' },
    concise: { count: 3, first: '目标' },
    code: { count: 4, first: '角色' },
  };
  for (const [id, spec] of Object.entries(expected)) {
    const result = enhance('帮我写个周报', { preset: id });
    assert.equal(result.ok, true, id);
    assert.equal(result.meta.preset, id);
    assert.equal(result.meta.presetSource, 'explicit');
    assert.equal(result.sections.length, spec.count, id);
    assert.equal(result.sections[0].title, spec.first, id);
  }
  assert.deepEqual(PRESET_IDS, ['auto', 'standard', 'six-section', 'goal-oriented', 'concise', 'code']);
  assert.deepEqual(PRESET_IDS_FROM_PRESETS, PRESET_IDS);
});

test('goal-oriented and code presets render english section titles', () => {
  const goal = enhance('帮我写一篇公众号文章', { preset: 'goal-oriented', language: 'en' });
  assert.deepEqual(goal.sections.map((section) => section.title), ['Goal', 'Background', 'Deliverable', 'Constraints', 'Success criteria']);
  const code = enhance(CODE_ZH, { preset: 'code', language: 'en' });
  assert.deepEqual(code.sections.map((section) => section.title), ['Role', 'Task', 'Constraints', 'Acceptance criteria']);
});

test('concise preset is a three-line prompt without markdown headings', () => {
  const result = enhance('帮我写个周报', { preset: 'concise' });
  const lines = result.enhanced.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(!result.enhanced.includes('##'));
  assert.deepEqual(result.sections.map((section) => section.title), ['目标', '动作', '输出']);
  assert.match(lines[0], /^目标：/);
  assert.ok(lines[0].includes(PLACEHOLDER_ZH));
});

test('preset registry exports stable serializable metadata', () => {
  assert.equal(getPreset('auto'), null);
  assert.equal(getPreset('standard').id, 'standard');
  assert.equal(getPreset('six-section').sections.length, 6);
  assert.equal(getPreset('nope'), null);
  assert.equal(getPreset('__proto__'), null);
  const described = describePresets();
  assert.equal(described.length, 5);
  assert.deepEqual(described.map((preset) => preset.id), ['standard', 'six-section', 'goal-oriented', 'concise', 'code']);
  assert.ok(JSON.stringify(described).includes('Task breakdown'));
  assert.deepEqual(describePresetsFromPresets(), described);
});

test('six-section provenance is documented, not presented as a vendor schema', () => {
  const sixSection = describePresets().find((preset) => preset.id === 'six-section');
  assert.ok(sixSection.descriptionZh.includes('公开的人用提示词写作指南'));
  assert.ok(sixSection.descriptionEn.includes('public human-facing prompt-writing guidance'));
  assert.ok(!JSON.stringify(describePresets()).includes('WorkBuddy'));
});

test('preset selection honors explicit ids and auto confidence rules', () => {
  assert.deepEqual(selectPreset({ preset: 'auto', intent: 'other', confidence: 0 }), {
    id: 'standard',
    presetSource: 'auto',
    strategy: 'auto-default',
    warning: undefined,
  });
  assert.deepEqual(selectPreset({ preset: 'auto', intent: 'code', confidence: 0.8 }), {
    id: 'code',
    presetSource: 'auto',
    strategy: 'auto-intent',
    warning: undefined,
  });
  assert.deepEqual(selectPreset({ preset: 'six-section', intent: 'code', confidence: 0.9 }), {
    id: 'six-section',
    presetSource: 'explicit',
    strategy: 'explicit',
  });
  assert.equal(selectPreset({ preset: 'nope', intent: 'other', confidence: 0 }).id, 'standard');
  assert.equal(selectPreset({ preset: 'nope', intent: 'other', confidence: 0 }).warning, 'preset-fallback');
});
