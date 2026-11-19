import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONFIG,
  HARD_INPUT_BYTES,
  WARNING_CODES,
  enhance,
  normalizeConfig,
} from '../lib/engine.js';
import {
  DEFAULT_MAX_INPUT_BYTES,
  classifyIntent,
  detectLanguage,
  normalizeInput,
  scoreSpecificity,
  stripZeroWidth,
  truncateToBytes,
  utf8Length,
} from '../lib/analysis.js';
import { PLACEHOLDER_EN, PLACEHOLDER_ZH } from '../lib/presets.js';

const VAGUE_ZH = '帮我弄一下这个东西';
const VAGUE_EN = 'take care of this for me';
const CODE_ZH = '用 TypeScript 写一个防抖函数，并补充单元测试和错误处理';

test('default result has the documented shape and resolved preset', () => {
  const result = enhance(VAGUE_ZH);
  assert.equal(result.ok, true);
  assert.equal(result.original, VAGUE_ZH);
  assert.equal(typeof result.enhanced, 'string');
  assert.ok(result.enhanced.length > 0);
  assert.ok(Array.isArray(result.sections));
  for (const section of result.sections) {
    assert.equal(typeof section.key, 'string');
    assert.equal(typeof section.title, 'string');
    assert.equal(typeof section.body, 'string');
    assert.ok(section.body.length > 0);
  }
  assert.equal(result.meta.enhancedChars, [...result.enhanced].length);
  assert.equal(result.meta.originalChars, VAGUE_ZH.length);
  assert.equal(result.meta.elapsedMs, 0);
  assert.equal(result.meta.truncated, false);
  assert.equal(result.meta.originalPreserved, false);
  assert.equal(result.meta.preset, 'standard');
  assert.notEqual(result.meta.preset, 'auto');
  assert.equal(result.meta.presetSource, 'auto');
  assert.equal(result.meta.strategy, 'auto-default');
  assert.equal(result.meta.language, 'zh');
  assert.equal(result.meta.detectedLanguage, 'zh');
  assert.ok(result.meta.intentConfidence >= 0 && result.meta.intentConfidence <= 1);
  assert.ok(result.meta.specificityBefore >= 0 && result.meta.specificityBefore <= 100);
  assert.ok(result.meta.specificityAfter >= 0 && result.meta.specificityAfter <= 100);
  assert.ok(Array.isArray(result.warnings));
});

test('enhance is byte-for-byte deterministic', () => {
  const options = { preset: 'six-section', includeOriginal: true, tone: 'detailed' };
  const first = enhance('帮我写个周报，下周要用', options);
  const second = enhance('帮我写个周报，下周要用', options);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('six-section emits the agreed zh section titles exactly', () => {
  const result = enhance('帮我写个周报', { preset: 'six-section' });
  assert.equal(result.ok, true);
  assert.equal(result.meta.preset, 'six-section');
  assert.equal(result.meta.presetSource, 'explicit');
  assert.deepEqual(result.sections.map((section) => section.title), ['目标', '输入', '动作', '约束', '输出', '验收']);
  assert.deepEqual(result.sections.map((section) => section.key), ['goal', 'input', 'actions', 'constraints', 'output', 'acceptance']);
  assert.match(result.enhanced, /^## 目标/m);
  assert.ok(result.enhanced.includes('## 验收'));
  assert.ok(result.enhanced.includes(PLACEHOLDER_ZH));
});

test('standard preset is role-first and is the auto default', () => {
  const zh = enhance(VAGUE_ZH);
  assert.deepEqual(zh.sections.map((section) => section.title), ['角色', '背景', '任务拆解', '输出格式', '约束', '验收标准']);
  assert.match(zh.enhanced, /^## 角色/m);
  const en = enhance(VAGUE_EN, { language: 'en' });
  assert.equal(en.meta.language, 'en');
  assert.deepEqual(en.sections.map((section) => section.title), ['Role', 'Background', 'Task breakdown', 'Output format', 'Constraints', 'Acceptance criteria']);
  assert.ok(en.enhanced.includes('## Role'));
});

test('english rendering uses idiomatic copy and english placeholders', () => {
  const result = enhance('write a weekly report', { preset: 'six-section', language: 'en' });
  assert.equal(result.meta.language, 'en');
  assert.equal(result.meta.detectedLanguage, 'en');
  assert.deepEqual(result.sections.map((section) => section.title), ['Goal', 'Input', 'Actions', 'Constraints', 'Output', 'Acceptance']);
  assert.equal(PLACEHOLDER_EN, '(to fill in)');
  assert.equal(PLACEHOLDER_ZH, '（待补充）');
  assert.ok(result.enhanced.includes(PLACEHOLDER_EN));
  assert.ok(!result.enhanced.includes(PLACEHOLDER_ZH));
});

test('mixed input is detected and still rendered in one language', () => {
  const result = enhance('把这个 weekly report 改成中文，语气正式一些');
  assert.equal(result.meta.detectedLanguage, 'mixed');
  assert.equal(result.meta.language, 'zh');
  assert.match(result.enhanced, /^## 角色/m);
});

test('empty or non-string input is rejected with empty-input', () => {
  for (const raw of ['', '   ', '\n\n\t ', '\u200b\u200d\ufeff', null, undefined, 42, {}]) {
    const result = enhance(raw);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'empty-input');
    assert.equal(typeof result.error.message, 'string');
  }
  assert.equal(stripZeroWidth('\u200babc\u200d'), 'abc');
});

test('byte truncation splits only on code-point boundaries', () => {
  assert.equal(utf8Length('汉'), 3);
  assert.equal(utf8Length('😀'), 4);
  assert.deepEqual(truncateToBytes('汉字😀a', 9), { text: '汉字', bytes: 6, truncated: true });
  assert.deepEqual(truncateToBytes('汉字😀a', 10), { text: '汉字😀', bytes: 10, truncated: true });
  assert.deepEqual(truncateToBytes('汉字😀a', 11), { text: '汉字😀a', bytes: 11, truncated: false });

  const raw = '汉'.repeat(50);
  const input = normalizeInput(raw, { maxInputBytes: 61 });
  assert.equal(input.ok, true);
  assert.equal(input.truncated, true);
  assert.equal(input.chars, 20);
  assert.equal(input.bytes, 60);
  assert.equal(input.originalChars, 50);
  assert.equal([...input.text].length, 20);
  assert.ok([...input.text].every((char) => char === '汉'));

  const result = enhance(raw, { preset: 'six-section', maxInputBytes: 61 });
  assert.equal(result.meta.truncated, true);
  assert.equal(result.meta.originalChars, 50);
  assert.equal(result.original, '汉'.repeat(20));
  assert.ok(result.warnings.includes('input-truncated'));
});

test('input over the hard ceiling is rejected with too-long', () => {
  const raw = '汉'.repeat(Math.ceil((HARD_INPUT_BYTES + 3) / 3));
  const result = enhance(raw);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'too-long');
  assert.equal(HARD_INPUT_BYTES, 262144);
});

test('normalization keeps fenced code intact and collapses blank lines', () => {
  const raw = '写个脚本\n\n\n\n请保留下面的代码：\n\n```js\nconst a = 1;\n\n\n\nconst b = 2;\n```\n尾部';
  const input = normalizeInput(raw);
  assert.equal(input.ok, true);
  assert.ok(input.text.includes('const a = 1;\n\n\n\nconst b = 2;'));
  assert.ok(!input.text.includes('\n\n\n\n请保留'));
  assert.ok(input.text.includes('```js'));
  assert.equal(input.text, input.text.trim());
  assert.equal(normalizeInput(123).reason, 'not-string');
});

test('caller context facts are rendered verbatim; originals are opt-in', () => {
  const raw = '帮我写个周报';
  const plain = enhance(raw, { preset: 'standard' });
  assert.equal(plain.meta.originalPreserved, false);
  assert.ok(!plain.enhanced.includes('原始请求'));

  const withContext = enhance(raw, {
    preset: 'standard',
    includeOriginal: true,
    context: {
      cwd: 'D:\\work\\proj',
      workspace: 'weekly',
      date: '2026-11-18',
      goal: '周五向主管汇报',
      files: ['notes.md', 'data.csv'],
    },
  });
  assert.equal(withContext.ok, true);
  assert.equal(withContext.meta.originalPreserved, true);
  assert.ok(withContext.enhanced.includes('原始请求'));
  assert.ok(withContext.enhanced.includes('D:\\work\\proj'));
  assert.ok(withContext.enhanced.includes('2026-11-18'));
  assert.ok(withContext.enhanced.includes('周五向主管汇报'));
  assert.ok(withContext.enhanced.includes('notes.md'));
  assert.ok(withContext.enhanced.includes('data.csv'));
  assert.ok(withContext.enhanced.includes('weekly'));
});

test('unknown facts render as explicit placeholders and raise a warning', () => {
  const zh = enhance('帮我写个周报');
  assert.ok(zh.enhanced.includes(PLACEHOLDER_ZH));
  assert.ok(zh.warnings.includes('facts-marked-unknown'));
  assert.equal(zh.meta.originalPreserved, false);

  const en = enhance('write a weekly report', { preset: 'standard' });
  assert.ok(en.enhanced.includes(PLACEHOLDER_EN));
  assert.ok(!en.enhanced.includes(PLACEHOLDER_ZH));
  assert.ok(en.warnings.includes('facts-marked-unknown'));
});

test('rendered prompts contain no HTML, emoji, or vendor wording', () => {
  const samples = [
    enhance('帮我写个周报'),
    enhance('write a weekly report', { preset: 'six-section', includeOriginal: true }),
    enhance(CODE_ZH),
    enhance('分析这份销售数据，给出转化率指标和图表'),
  ];
  for (const result of samples) {
    assert.ok(!/<[a-z/][^>]*>/i.test(result.enhanced));
    assert.ok(!/\p{Extended_Pictographic}/u.test(result.enhanced));
    assert.ok(!result.enhanced.includes('WorkBuddy'));
  }
});

test('tone changes verbosity without changing the schema', () => {
  const concise = enhance('帮我写个周报', { preset: 'six-section', tone: 'concise' });
  const standard = enhance('帮我写个周报', { preset: 'six-section', tone: 'standard' });
  const detailed = enhance('帮我写个周报', { preset: 'six-section', tone: 'detailed' });
  for (const result of [concise, standard, detailed]) {
    assert.deepEqual(result.sections.map((section) => section.key), ['goal', 'input', 'actions', 'constraints', 'output', 'acceptance']);
  }
  assert.ok(utf8Length(concise.enhanced) < utf8Length(standard.enhanced));
  assert.ok(utf8Length(standard.enhanced) < utf8Length(detailed.enhanced));
});

test('output is capped in bytes with a warning', () => {
  const raw = '帮我写一份周报，包含本周数据、问题与下周计划。'.repeat(6);
  const result = enhance(raw, { preset: 'six-section', maxOutputBytes: 300 });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.includes('output-truncated'));
  assert.equal(result.meta.truncated, true);
  assert.ok(utf8Length(result.enhanced) <= 300);
  assert.ok(utf8Length(result.enhanced) > 0);
});

test('invalid config is rejected; invalid fields fall back silently', () => {
  const rejected = enhance('帮我写个周报', 'not-an-object');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'invalid-config');
  assert.equal(enhance('帮我写个周报', []).error.code, 'invalid-config');

  const normalized = normalizeConfig({
    tone: 'loud',
    language: 'fr',
    maxInputBytes: 'many',
    maxOutputBytes: 'lots',
    includeOriginal: 'yes',
    context: 'nope',
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.config.tone, 'standard');
  assert.equal(normalized.config.language, 'auto');
  assert.equal(normalized.config.maxInputBytes, DEFAULT_MAX_INPUT_BYTES);
  assert.equal(normalized.config.maxOutputBytes, DEFAULT_CONFIG.maxOutputBytes);
  assert.equal(normalized.config.includeOriginal, false);
  assert.deepEqual(normalized.warnings, []);

  const clamped = normalizeConfig({ maxInputBytes: 1 });
  assert.equal(clamped.config.maxInputBytes, 16);

  const fallback = enhance('帮我写个周报', { tone: 'loud', language: 'fr', maxInputBytes: 'many' });
  assert.equal(fallback.ok, true);
  assert.ok(!fallback.warnings.includes('preset-fallback'));
  assert.equal(fallback.meta.language, 'zh');
});

test('unknown explicit preset falls back to auto resolution', () => {
  const result = enhance(VAGUE_ZH, { preset: 'no-such-preset' });
  assert.equal(result.ok, true);
  assert.equal(result.meta.preset, 'standard');
  assert.equal(result.meta.presetSource, 'auto');
  assert.ok(result.warnings.includes('preset-fallback'));
});

test('includeOriginal keeps exactly one copy of the request text', () => {
  const raw = '帮我写个周报，下周要用';
  for (const preset of ['standard', 'six-section', 'goal-oriented', 'code']) {
    const result = enhance(raw, { preset, includeOriginal: true });
    assert.equal(result.ok, true, preset);
    assert.equal(result.meta.originalPreserved, true, preset);
    assert.equal(result.enhanced.split(raw).length - 1, 1, preset);
  }
  const compact = enhance(raw, { preset: 'concise', includeOriginal: true });
  assert.equal(compact.meta.originalPreserved, true);
  assert.equal(compact.enhanced.split(raw).length - 1, 1);
  const plain = enhance(raw, { preset: 'six-section' });
  assert.equal(plain.meta.originalPreserved, false);
});

test('warnings only use the documented stable codes', () => {
  const samples = [
    enhance(VAGUE_ZH),
    enhance('汉'.repeat(50), { maxInputBytes: 61 }),
    enhance('帮我写个周报', { preset: 'no-such-preset' }),
    enhance('帮我写个周报', { preset: 'concise', maxOutputBytes: 300 }),
    enhance(VAGUE_ZH, { language: 'fr', tone: 'loud' }),
  ];
  for (const result of samples) {
    for (const code of result.warnings) {
      assert.ok(WARNING_CODES.includes(code), code);
    }
  }
  assert.deepEqual(WARNING_CODES, ['input-truncated', 'output-truncated', 'facts-marked-unknown', 'preset-fallback']);
  assert.ok(!WARNING_CODES.includes('unknown-preset'));
  assert.ok(!WARNING_CODES.includes('config-fallback'));
});

test('explicit language overrides detection', () => {
  const result = enhance(VAGUE_ZH, { language: 'en', preset: 'standard' });
  assert.equal(result.meta.language, 'en');
  assert.equal(result.meta.detectedLanguage, 'zh');
  assert.equal(result.sections[0].title, 'Role');
  assert.ok(result.enhanced.includes(PLACEHOLDER_EN));
});

test('specificity scoring is bounded, complete, and monotone', () => {
  const vague = scoreSpecificity(VAGUE_ZH);
  assert.ok(Number.isInteger(vague.score));
  assert.ok(vague.score >= 0 && vague.score <= 100);
  assert.ok(Array.isArray(vague.signals));
  assert.ok(vague.missing.includes('constraints'));
  assert.ok(vague.missing.includes('output-format'));
  assert.ok(vague.missing.includes('time-scope'));

  const detailed = scoreSpecificity(
    '背景：我在电商公司做运营，每周五要向主管汇报本周数据。要求：写一份周报，用表格列出 3 个核心指标，风格简洁，不超过 500 字。输出格式：markdown 表格加要点列表。验收标准：数据准确、无编造，主管一次性通过。截止时间：本周五 18:00。',
  );
  assert.ok(detailed.score > vague.score);
  assert.ok(detailed.score >= 80);
  assert.ok(detailed.missing.length < vague.missing.length);

  const steps = [
    '帮我写个周报',
    '帮我写个周报。背景：我在电商公司做运营。',
    '帮我写个周报。背景：我在电商公司做运营。要求：必须包含三个核心指标。',
    '帮我写个周报。背景：我在电商公司做运营。要求：必须包含三个核心指标。输出格式：表格加要点。',
    '帮我写个周报。背景：我在电商公司做运营。要求：必须包含三个核心指标。输出格式：表格加要点。验收标准：数据准确。截止时间：本周五。',
  ];
  const scores = steps.map((step) => scoreSpecificity(step).score);
  for (let index = 1; index < scores.length; index += 1) {
    assert.ok(scores[index] >= scores[index - 1], `scores=${scores.join(',')}`);
  }
  assert.equal(scoreSpecificity('').score, 0);
  assert.deepEqual(scoreSpecificity('').missing, ['goal', 'context', 'constraints', 'output-format', 'acceptance', 'time-scope']);
});

test('intent classification returns bounded confidence and matched signals', () => {
  const code = classifyIntent(CODE_ZH);
  assert.equal(code.intent, 'code');
  assert.ok(code.confidence >= 0.6 && code.confidence <= 1);
  assert.ok(code.signals.includes('函数'));

  const planning = classifyIntent('帮我制定下季度的产品路线图，列出里程碑和优先级');
  assert.equal(planning.intent, 'planning');
  assert.ok(planning.confidence >= 0.6);

  const other = classifyIntent(VAGUE_ZH);
  assert.equal(other.intent, 'other');
  assert.ok(other.confidence <= 0.3);
  assert.deepEqual(other.signals, []);

  for (const sample of ['', 'x', '写代码', '分析数据']) {
    const result = classifyIntent(sample);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
    assert.ok(Array.isArray(result.signals));
  }
});

test('language detection separates zh, en, and mixed', () => {
  assert.equal(detectLanguage('帮我写一份周报'), 'zh');
  assert.equal(detectLanguage('write a weekly report'), 'en');
  assert.equal(detectLanguage('把这个 weekly report 改成中文，语气正式一些'), 'mixed');
  assert.equal(detectLanguage(''), 'en');
});

test('engine defaults are frozen and documented', () => {
  assert.equal(Object.isFrozen(DEFAULT_CONFIG), true);
  assert.equal(DEFAULT_CONFIG.preset, 'auto');
  assert.equal(DEFAULT_CONFIG.language, 'auto');
  assert.equal(DEFAULT_CONFIG.maxInputBytes, DEFAULT_MAX_INPUT_BYTES);
  assert.equal(DEFAULT_CONFIG.maxOutputBytes, 16000);
  assert.equal(DEFAULT_CONFIG.tone, 'standard');
  assert.equal(DEFAULT_CONFIG.includeOriginal, false);
  assert.equal(DEFAULT_MAX_INPUT_BYTES, 8000);
});
