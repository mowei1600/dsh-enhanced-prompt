/**
 * Section copy and deterministic filler heuristics for the prompt presets.
 *
 * Kept separate from `presets.js` so that both modules stay small and easy to
 * review. This module has no imports: it is pure data plus pure functions.
 *
 * @module preset-copy
 */

/**
 * @typedef {'zh' | 'en'} RenderLanguage
 * @typedef {'concise' | 'standard' | 'detailed'} Tone
 * @typedef {{ cwd?: string, workspace?: string, date?: string, goal?: string, files?: string[] }} EngineContext
 * @typedef {Object} SectionContext
 * @property {string} text
 * @property {RenderLanguage} lang
 * @property {'zh' | 'en' | 'mixed'} inputLanguage
 * @property {string} intent
 * @property {Tone} tone
 * @property {EngineContext} context
 * @property {boolean} includeOriginal
 * @typedef {Object} SectionDefinition
 * @property {string} key
 * @property {string} titleZh
 * @property {string} titleEn
 * @property {string} guidanceZh
 * @property {string} guidanceEn
 * @property {(ctx: SectionContext) => string} fill
 */

/** Chinese placeholder rendered where a fact is genuinely unknown. @type {string} */
export const PLACEHOLDER_ZH = '（待补充）';

/** English placeholder rendered where a fact is genuinely unknown. @type {string} */
export const PLACEHOLDER_EN = '(to fill in)';

const SECTION_META = {
  role: { titleZh: '角色', titleEn: 'Role', guidanceZh: '说明由谁来完成，以及以什么工作方式推进。', guidanceEn: 'State who performs the work and how they approach it.' },
  goal: { titleZh: '目标', titleEn: 'Goal', guidanceZh: '用一句话写清要达成的结果。', guidanceEn: 'Put the desired outcome in one sentence.' },
  input: { titleZh: '输入', titleEn: 'Input', guidanceZh: '列出已给出的信息、素材与限制。', guidanceEn: 'List the information, material, and limits already provided.' },
  background: { titleZh: '背景', titleEn: 'Background', guidanceZh: '补充与任务相关的现状与上下文。', guidanceEn: 'Add the current situation and context behind the request.' },
  context: { titleZh: '背景', titleEn: 'Background', guidanceZh: '补充与任务相关的现状与上下文。', guidanceEn: 'Add the current situation and context behind the request.' },
  actions: { titleZh: '动作', titleEn: 'Actions', guidanceZh: '把任务拆成可执行的步骤。', guidanceEn: 'Break the work into executable steps.' },
  'task-breakdown': { titleZh: '任务拆解', titleEn: 'Task breakdown', guidanceZh: '把任务拆成有先后顺序的步骤。', guidanceEn: 'Break the work into ordered steps.' },
  task: { titleZh: '任务', titleEn: 'Task', guidanceZh: '写明要实现的行为与现有差异。', guidanceEn: 'State the behavior to implement and the gap from today.' },
  'output-format': { titleZh: '输出格式', titleEn: 'Output format', guidanceZh: '写清交付物、格式与篇幅。', guidanceEn: 'Specify the deliverable, format, and length.' },
  output: { titleZh: '输出', titleEn: 'Output', guidanceZh: '写清交付物、格式与篇幅。', guidanceEn: 'Specify the deliverable, format, and length.' },
  deliverable: { titleZh: '交付物', titleEn: 'Deliverable', guidanceZh: '写清最终要交付的成品。', guidanceEn: 'Describe the final artifact to be delivered.' },
  constraints: { titleZh: '约束', titleEn: 'Constraints', guidanceZh: '写下必须遵守的边界与禁止项。', guidanceEn: 'Record the boundaries and prohibitions to respect.' },
  acceptance: { titleZh: '验收标准', titleEn: 'Acceptance criteria', guidanceZh: '列出可逐条检查的完成标准。', guidanceEn: 'List checkable criteria for completion.' },
  'success-criteria': { titleZh: '成功标准', titleEn: 'Success criteria', guidanceZh: '列出判定成功的标准。', guidanceEn: 'List the criteria that define success.' },
};

const STYLE_ZH = { concise: '简洁直接，去掉客套与重复', standard: '准确、清楚、可直接使用', detailed: '完整、有条理，保留必要的依据' };
const STYLE_EN = { concise: 'concise and direct, no filler', standard: 'precise, clear, ready to use', detailed: 'thorough and well structured, with the reasoning kept' };

const INTENT_ROLES = {
  writing: { zh: '内容编辑', en: 'content editor' }, code: { zh: '资深软件工程师', en: 'senior software engineer' },
  data: { zh: '数据分析师', en: 'data analyst' }, research: { zh: '研究分析师', en: 'research analyst' },
  planning: { zh: '项目负责人', en: 'project lead' }, ops: { zh: '运维工程师', en: 'operations engineer' },
  other: { zh: '经验丰富的执行者', en: 'experienced practitioner' },
};

const INTENT_LABELS = {
  writing: { zh: '内容写作', en: 'writing' }, code: { zh: '代码开发', en: 'coding' },
  data: { zh: '数据分析', en: 'data analysis' }, research: { zh: '调研', en: 'research' },
  planning: { zh: '计划排期', en: 'planning' }, ops: { zh: '运维排障', en: 'operations' },
  other: { zh: '通用任务', en: 'general task' },
};

const INTENT_STEPS = {
  writing: {
    zh: ['确认读者、使用场景与期望篇幅。', '从素材中提炼关键信息，先搭好提纲。', '按提纲写出完整初稿，段落层次清楚。', '通读修改，核对事实、数字与专有名词。'],
    en: ['Confirm the audience, scenario, and expected length.', 'Pull the key points from the material and outline the structure.', 'Draft the full piece following the outline with clear paragraphs.', 'Re-read and fix facts, figures, and proper nouns.'],
  },
  code: {
    zh: ['先说清目标行为、现有实现与期望差异。', '给出可直接运行的代码或补丁，注明文件与函数位置。', '补齐边界条件、错误处理与关键注释。', '列出验证步骤与预期结果。'],
    en: ['State the target behavior, the current implementation, and the gap.', 'Provide runnable code or a patch, naming files and functions.', 'Cover edge cases, error handling, and essential comments.', 'List verification steps and expected results.'],
  },
  data: {
    zh: ['确认数据来源、字段含义与统计口径。', '清洗异常值与缺失值，并说明处理方式。', '按维度计算指标，给出关键对比与趋势。', '用表格或图表呈现结论，并注明假设与局限。'],
    en: ['Confirm the data source, field meanings, and metric definitions.', 'Clean outliers and missing values, and state how you handled them.', 'Compute metrics by dimension and highlight key comparisons and trends.', 'Present conclusions in tables or charts, noting assumptions and limits.'],
  },
  research: {
    zh: ['明确研究问题与范围边界。', '列出需要查阅的信息来源与筛选标准。', '提取证据并区分事实、推断与观点。', '汇总结论，标注不确定项与待验证假设。'],
    en: ['Define the research question and its scope.', 'List the sources to consult and the screening criteria.', 'Extract evidence and separate facts from inference and opinion.', 'Summarize findings, flagging unknowns and hypotheses to verify.'],
  },
  planning: {
    zh: ['确认目标、截止时间与可用资源。', '拆分阶段任务，标注依赖关系。', '估算每步工作量并排出优先级。', '给出里程碑、风险与备选方案。'],
    en: ['Confirm the goal, deadline, and available resources.', 'Break the work into stages and mark dependencies.', 'Estimate effort per step and set priorities.', 'Add milestones, risks, and fallback options.'],
  },
  ops: {
    zh: ['描述现状、故障现象与影响范围。', '按步骤还原过程并定位根因。', '给出修复或规避方案，注明回滚方式。', '说明验证方式与后续监控项。'],
    en: ['Describe the current state, symptoms, and impact.', 'Reproduce the issue step by step and locate the root cause.', 'Provide a fix or workaround, including rollback steps.', 'State how to verify the fix and what to monitor afterwards.'],
  },
  other: {
    zh: ['澄清目标、受众与交付形式。', '拆解为可执行的小步骤，按顺序推进。', '完成初稿后逐项自查。', '补充依据与后续建议。'],
    en: ['Clarify the goal, audience, and delivery form.', 'Split the work into small sequential steps.', 'Draft the result, then check it item by item.', 'Add supporting evidence and follow-up suggestions.'],
  },
};

const INTENT_DELIVERABLES = {
  writing: { zh: '一份完整的文稿（标题加正文），可直接复制使用', en: 'a complete piece of writing (title plus body) that can be copied as-is' },
  code: { zh: '可运行的代码或补丁，附文件位置、关键函数与验证命令', en: 'runnable code or a patch with file locations, key functions, and verification commands' },
  data: { zh: '分析结论与关键指标表，列名和口径清楚', en: 'findings with a metrics table whose columns and definitions are clear' },
  research: { zh: '结构化的调研结论，标明来源与证据强弱', en: 'a structured research summary with sources and evidence strength' },
  planning: { zh: '分阶段任务计划，含负责人、依赖与里程碑', en: 'a staged plan with owners, dependencies, and milestones' },
  ops: { zh: '问题定位说明、修复步骤与验证/回滚方案', en: 'a diagnosis, fix steps, and a verification and rollback plan' },
  other: { zh: '满足目标的成品，结构清晰、可直接使用', en: 'a finished result that meets the goal, clearly structured and ready to use' },
};

const ZH_POLITE_RE = /^(?:请问|请|麻烦你?|帮我|帮忙|给我|我想|我要|我想要|我需要|需要|希望|求)\s*/;
const EN_POLITE_RE = /^(?:please|kindly|can you|could you|would you|will you|help me|i need|i want|i would like|i'd like|we need)\s+/i;

/**
 * Placeholder text for a rendering language; used wherever a fact is unknown.
 * @param {RenderLanguage | string} lang rendering language
 * @returns {string} '（待补充）' for zh, '(to fill in)' otherwise
 */
export function placeholder(lang) {
  return lang === 'en' ? PLACEHOLDER_EN : PLACEHOLDER_ZH;
}

// Placeholder for the current rendering language.
function ph(ctx) { return placeholder(ctx.lang); }

// Render a `- label: value` line in the current language.
function kv(ctx, zh, en, value) {
  return `- ${ctx.lang === 'zh' ? zh : en}${ctx.lang === 'zh' ? '：' : ': '}${value}`;
}

// Clip a line to a code-point budget.
function clip(value, max) {
  const chars = [...value];
  return chars.length <= max ? value : `${chars.slice(0, max).join('')}...`;
}

// Compress any whitespace run to a single space.
function oneLine(value) { return value.replace(/\s+/g, ' ').trim(); }

// One-line quote of the user's request for use inside a body.
function rawQuote(ctx) { return clip(oneLine(ctx.text), 200); }

// Strip polite lead-ins from the request to derive a goal line.
function deriveGoal(ctx) {
  let text = oneLine(ctx.text);
  for (let i = 0; i < 4; i += 1) {
    const before = text;
    text = text.replace(ZH_POLITE_RE, '').replace(EN_POLITE_RE, '').trim();
    if (text === before) break;
  }
  text = text.replace(/[。．.!！?？;；]+$/u, '').trim();
  if (!text) return ph(ctx);
  if (ctx.lang === 'en' && /^[a-z]/.test(text)) text = text.charAt(0).toUpperCase() + text.slice(1);
  return clip(text, 160);
}

// Tone-aware list limit: concise trims, detailed extends.
function toneLimit(ctx, standard) {
  if (ctx.tone === 'concise') return Math.max(2, standard - 2);
  if (ctx.tone === 'detailed') return standard + 2;
  return standard;
}

// Facts supplied by the caller, rendered as bullets.
function factLines(ctx) {
  const lines = [];
  const context = ctx.context ?? {};
  if (context.goal) lines.push(kv(ctx, '补充目标', 'Additional goal', context.goal));
  if (context.cwd) lines.push(kv(ctx, '工作目录', 'Working directory', context.cwd));
  if (context.workspace) lines.push(kv(ctx, '工作区', 'Workspace', context.workspace));
  if (context.date) lines.push(kv(ctx, '参考日期', 'Reference date', context.date));
  if (Array.isArray(context.files) && context.files.length > 0) {
    lines.push(kv(ctx, '相关文件', 'Files in scope', context.files.join(ctx.lang === 'zh' ? '、' : ', ')));
  }
  return lines;
}

// Goal body used by the goal-first presets.
function goalBody(ctx) {
  const head = ctx.lang === 'zh' ? `一句话目标：${deriveGoal(ctx)}` : `One-line goal: ${deriveGoal(ctx)}`;
  const details = [
    kv(ctx, '服务对象 / 使用场景', 'Audience / scenario', ph(ctx)),
    kv(ctx, '期望效果', 'Expected result', ph(ctx)),
  ];
  if (ctx.tone === 'detailed') details.push(kv(ctx, '不在本次范围内', 'Out of scope', ph(ctx)));
  if (ctx.tone === 'concise') return [head, ...details.slice(0, 1)].join('\n');
  return [head, '', ...details].join('\n');
}

// Input body for the six-section preset; the raw line disappears when the engine renders the original block.
function inputBody(ctx) {
  const facts = factLines(ctx);
  const rawLine = ctx.includeOriginal ? [] : [kv(ctx, '需求原文', 'Request as written', rawQuote(ctx))];
  return [
    ...rawLine, ...facts,
    kv(ctx, '补充背景', 'Additional background', ph(ctx)),
    kv(ctx, '可引用的素材 / 附件', 'Source material / attachments', ph(ctx)),
  ].join('\n');
}

// Background body for the role-first and goal-oriented presets.
function backgroundBody(ctx) {
  const facts = factLines(ctx);
  const rawLine = ctx.includeOriginal ? [] : [kv(ctx, '需求原文', 'Request as written', rawQuote(ctx))];
  return [
    ...rawLine, ...facts,
    kv(ctx, '补充背景 / 前置信息', 'Additional background / context', ph(ctx)),
    kv(ctx, '可引用的素材或附件', 'Source material / attachments', ph(ctx)),
    kv(ctx, '时间范围', 'Time range', ph(ctx)),
  ].join('\n');
}

// Ordered steps body shared by the actions and task-breakdown sections.
function actionsBody(ctx) {
  const table = INTENT_STEPS[ctx.intent] ?? INTENT_STEPS.other;
  const steps = (ctx.lang === 'zh' ? table.zh : table.en).slice(0, toneLimit(ctx, 4));
  return steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
}

// Output body shared by the output, output-format, and deliverable sections.
function formatBody(ctx) {
  const deliverable = INTENT_DELIVERABLES[ctx.intent] ?? INTENT_DELIVERABLES.other;
  const lines = [
    kv(ctx, '交付内容', 'What to deliver', ctx.lang === 'zh' ? deliverable.zh : deliverable.en),
    kv(ctx, '格式 / 篇幅', 'Format / length', ph(ctx)),
    kv(ctx, '必须包含的要素', 'Required elements', ph(ctx)),
  ];
  if (ctx.tone === 'detailed') lines.push(kv(ctx, '可选加分项', 'Optional extras', ph(ctx)));
  return lines.slice(0, toneLimit(ctx, 4)).join('\n');
}

// Constraints body; the `code` flavour adds engineering guardrails.
function constraintsBody(ctx, flavor) {
  const items = ctx.lang === 'zh'
    ? [
        '只依据已给出的信息作答，不编造事实、数据、引用或链接。',
        '不确定的内容标注「（待补充）」，不要自行假设。',
        '输出语言为中文，术语前后保持一致。',
        `风格：${STYLE_ZH[ctx.tone]}。`,
        `篇幅与格式等硬性要求：${ph(ctx)}`,
      ]
    : [
        'Work only from the information given; never invent facts, figures, citations, or links.',
        'Mark anything uncertain as (to fill in) instead of assuming it.',
        'Write in English and keep terminology consistent.',
        `Style: ${STYLE_EN[ctx.tone]}.`,
        `Hard requirements on length and format: ${ph(ctx)}`,
      ];
  if (flavor === 'code') {
    items.push(ctx.lang === 'zh'
      ? '给出最小可行改动，避免无关重构；代码可运行，关键逻辑加注释。'
      : 'Prefer the smallest workable change over unrelated refactoring; code must run, with comments on key logic.');
    items.push(ctx.lang === 'zh' ? '不使用未声明的第三方依赖。' : 'Do not add undeclared third-party dependencies.');
  }
  const limit = flavor === 'code' ? (ctx.tone === 'concise' ? 5 : 7) : toneLimit(ctx, 5);
  return items.slice(0, limit).map((item) => `- ${item}`).join('\n');
}

// Acceptance body; the `code` flavour adds runnable-code checks.
function acceptanceBody(ctx, flavor) {
  const items = ctx.lang === 'zh'
    ? [
        '目标中的每一项要求都已覆盖，没有遗漏。',
        '没有编造的事实、数据或引用；不确定项都标注了「（待补充）」。',
        '格式、语言与约束符合要求，结果可直接使用。',
        '自检：通读一遍，语句通顺、术语一致、无错别字。',
      ]
    : [
        'Every requirement in the goal is covered.',
        'No invented facts, figures, or citations; unknowns are marked (to fill in).',
        'Format, language, and constraints are respected, and the result can be used as-is.',
        'Self-check: read it once for fluency, consistent terms, and typos.',
      ];
  if (flavor === 'code') {
    items.push(ctx.lang === 'zh'
      ? '代码可运行，覆盖正常路径与至少一个异常路径，并附验证方式。'
      : 'The code runs, covers the normal path and at least one failure path, and comes with verification steps.');
  }
  if (ctx.tone === 'detailed') {
    items.push(ctx.lang === 'zh' ? '如有假设，单独列出并说明理由。' : 'Any assumptions are listed separately with their rationale.');
  }
  return items.slice(0, toneLimit(ctx, 5)).map((item) => `- ${item}`).join('\n');
}

// Role body for the standard preset.
function roleBody(ctx) {
  const role = INTENT_ROLES[ctx.intent] ?? INTENT_ROLES.other;
  const label = INTENT_LABELS[ctx.intent] ?? INTENT_LABELS.other;
  if (ctx.lang === 'zh') {
    return [
      `角色：${role.zh}。请先理清目标与背景，再按步骤推进，交付前完成自查。`,
      '',
      `- 任务类型：${label.zh}`,
      `- 服务对象 / 使用场景：${ph(ctx)}`,
    ].join('\n');
  }
  return [
    `Role: ${role.en}. Clarify the goal and background first, work through the task step by step, and self-check before delivering.`,
    '',
    `- Task type: ${label.en}`,
    `- Audience / scenario: ${ph(ctx)}`,
  ].join('\n');
}

// Role body for the code preset.
function codeRoleBody(ctx) {
  if (ctx.lang === 'zh') {
    return [
      '角色：资深软件工程师。请先确认目标行为与现有实现，再给出可运行的最小改动，并说明验证方式。',
      '',
      `- 服务对象 / 使用场景：${ph(ctx)}`,
    ].join('\n');
  }
  return [
    'Role: senior software engineer. Confirm the target behavior and the current implementation first, then provide the smallest runnable change with verification steps.',
    '',
    `- Audience / scenario: ${ph(ctx)}`,
  ].join('\n');
}

// Task body for the code preset; the raw line disappears when the engine renders the original block.
function codeTaskBody(ctx) {
  const facts = factLines(ctx);
  const rawLine = ctx.includeOriginal ? [] : [kv(ctx, '需求原文', 'Request as written', rawQuote(ctx))];
  return [
    ...rawLine, ...facts,
    kv(ctx, '目标行为', 'Target behavior', deriveGoal(ctx)),
    kv(ctx, '现状 / 已有实现', 'Current implementation', ph(ctx)),
    kv(ctx, '运行环境 / 技术栈', 'Runtime / tech stack', ph(ctx)),
  ].join('\n');
}

// Compact one-line goal for the concise preset.
function compactGoal(ctx) {
  return ctx.lang === 'zh'
    ? `完成「${deriveGoal(ctx)}」，对象与场景：${ph(ctx)}`
    : `Complete "${deriveGoal(ctx)}" for this audience and scenario: ${ph(ctx)}`;
}

// Compact one-line actions for the concise preset.
function compactActions(ctx) {
  const table = INTENT_STEPS[ctx.intent] ?? INTENT_STEPS.other;
  const steps = (ctx.lang === 'zh' ? table.zh : table.en).slice(0, 3);
  const joiner = ctx.lang === 'zh' ? '；' : '; ';
  return steps.map((step) => step.replace(/[。.]$/u, '')).join(joiner);
}

// Compact one-line output for the concise preset.
function compactOutput(ctx) {
  const deliverable = INTENT_DELIVERABLES[ctx.intent] ?? INTENT_DELIVERABLES.other;
  return ctx.lang === 'zh'
    ? `交付${deliverable.zh}；格式与篇幅：${ph(ctx)}`
    : `Deliver ${deliverable.en}; format and length: ${ph(ctx)}`;
}

/**
 * Filler functions keyed by role. Each one deterministically renders one
 * section body from a {@link SectionContext}; unknown facts become placeholders.
 * @type {Object<string, (ctx: SectionContext) => string>}
 */
export const FILLERS = {
  roleBody,
  codeRoleBody,
  goalBody,
  inputBody,
  backgroundBody,
  actionsBody,
  formatBody,
  taskBody: codeTaskBody,
  constraints: (ctx) => constraintsBody(ctx, 'general'),
  codeConstraints: (ctx) => constraintsBody(ctx, 'code'),
  acceptance: (ctx) => acceptanceBody(ctx, 'general'),
  codeAcceptance: (ctx) => acceptanceBody(ctx, 'code'),
  compactGoal,
  compactActions,
  compactOutput,
};

/**
 * Build a section definition from the shared title/guidance metadata and a filler.
 * @param {string} key section key
 * @param {(ctx: SectionContext) => string} fill filler
 * @param {{ titleZh?: string, titleEn?: string }} [overrides] per-preset title overrides
 * @returns {SectionDefinition} section definition
 */
export function section(key, fill, overrides = {}) {
  return { key, ...SECTION_META[key], ...overrides, fill };
}
