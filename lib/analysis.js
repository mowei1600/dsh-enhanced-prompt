/**
 * Deterministic text analysis for the enhanced-prompt engine.
 *
 * Every helper is pure: the same input always produces the same output. There
 * is no file-system access, no clock, no randomness, no network, and no
 * third-party dependency.
 *
 * @module analysis
 */

/**
 * @typedef {'zh' | 'en' | 'mixed'} DetectedLanguage
 * @typedef {'writing' | 'code' | 'data' | 'research' | 'planning' | 'ops' | 'other'} IntentId
 * @typedef {'goal' | 'context' | 'constraints' | 'output-format' | 'acceptance' | 'time-scope'} SpecificityDimension
 * @typedef {{ dimension: SpecificityDimension, signal: string }} SpecificitySignal
 * @typedef {{ score: number, missing: SpecificityDimension[], signals: SpecificitySignal[] }} SpecificityResult
 * @typedef {{ intent: IntentId, confidence: number, signals: string[] }} IntentResult
 * @typedef {{ text: string, bytes: number, truncated: boolean }} CutResult
 * @typedef {Object} NormalizedInput
 * @property {boolean} ok
 * @property {'not-string' | 'empty'} [reason]
 * @property {string} text normalized text (byte-capped when `truncated`)
 * @property {number} originalChars code points after cleanup, before the byte cap
 * @property {number} originalBytes UTF-8 bytes after cleanup, before the byte cap
 * @property {number} chars code points of `text`
 * @property {number} bytes UTF-8 bytes of `text`
 * @property {boolean} truncated
 */

/** Default cap for normalized input, in UTF-8 bytes. @type {number} */
export const DEFAULT_MAX_INPUT_BYTES = 8000;

/** Canonical intent ids returned by {@link classifyIntent}. @type {IntentId[]} */
export const INTENT_IDS = ['writing', 'code', 'data', 'research', 'planning', 'ops', 'other'];

/** Specificity dimensions checked by {@link scoreSpecificity}, in fixed order. @type {SpecificityDimension[]} */
export const SPECIFICITY_DIMENSIONS = ['goal', 'context', 'constraints', 'output-format', 'acceptance', 'time-scope'];

const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;
const LATIN_RE = /[A-Za-z]/g;

/** Tie-break priority when two intents score the same. */
const INTENT_ORDER = ['code', 'data', 'research', 'ops', 'planning', 'writing'];

/** Keyword lists per intent, zh first then en, matched case-insensitively. */
const INTENT_LEXICON = {
  writing: {
    zh: ['写', '撰写', '起草', '文案', '文章', '周报', '日报', '报告', '邮件', '稿子', '润色', '改写', '总结', '复盘', '汇报', '纪要', '提纲', '演讲稿', '公众号', '标题', '故事'],
    en: ['write', 'draft', 'article', 'essay', 'post', 'report', 'email', 'copy', 'rewrite', 'proofread', 'summary', 'newsletter', 'headline', 'story'],
  },
  code: {
    zh: ['代码', '函数', '脚本', '接口', '报错', '编译', '重构', '单元测试', '依赖', '正则', '算法', '组件', '数据库', '部署', '错误处理'],
    en: ['code', 'function', 'script', 'api', 'bug', 'compile', 'refactor', 'unit test', 'dependency', 'regex', 'algorithm', 'component', 'database', 'deploy', 'typescript', 'javascript', 'python'],
  },
  data: {
    zh: ['数据', '表格', '统计', '指标', 'csv', 'excel', '分析', '图表', '报表', '转化率', '口径'],
    en: ['data', 'dataset', 'csv', 'excel', 'statistic', 'metric', 'chart', 'pivot', 'analysis', 'conversion', 'query'],
  },
  research: {
    zh: ['调研', '研究', '资料', '文献', '竞品', '访谈', '问卷', '证据', '来源', '综述'],
    en: ['research', 'survey', 'literature', 'competitor', 'interview', 'questionnaire', 'evidence', 'source', 'review'],
  },
  planning: {
    zh: ['计划', '规划', '排期', '方案', '里程碑', '优先级', '拆解', '路线图', '流程', '资源'],
    en: ['plan', 'roadmap', 'milestone', 'schedule', 'priority', 'timeline', 'strategy', 'breakdown', 'resource'],
  },
  ops: {
    zh: ['运维', '部署', '故障', '排查', '监控', '日志', '回滚', '性能', '报警', '服务器'],
    en: ['ops', 'deploy', 'incident', 'troubleshoot', 'monitor', 'log', 'rollback', 'performance', 'alert', 'server'],
  },
};

/** Regex probes per specificity dimension; all are non-global by design. */
const DIMENSION_PATTERNS = {
  goal: [
    /(?:帮我|请你?|麻烦|需要|想要|我要|希望|目标是|目的是)[^。！？!?\n]{0,60}/,
    /(?:写|做|生成|整理|分析|设计|实现|修改|优化|总结|翻译|规划|检查|审查|搭建|制作|给出|列出)/,
    /\b(?:write|create|make|build|draft|design|analy[sz]e|summari[sz]e|fix|refactor|plan|prepare|generate|review|translate|list|explain|compare)\b/i,
  ],
  context: [
    /(?:背景|上下文|目前|当前|现状|已有|现有|基于|依据|参考|素材|资料|附件|文件|链接|项目|公司|团队|用户)/,
    /\b(?:background|context|currently|existing|given|based on|reference|material|attachment|file|link|repository|repo|project|team|customer|user)\b/i,
    /```[\s\S]*?```/,
    /(?:https?:\/\/|www\.)\S+/i,
    /(?:[A-Za-z]:\\|\.\/|\/[\w.-]+\/)/,
    /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/,
  ],
  constraints: [
    /(?:不要|不得|不能|必须|务必|只能|仅限|限制|不超过|至少|最多|字数|风格|语气|格式|禁止|避免|保持|尽量|优先)/,
    /\b(?:must|should|shall|only|avoid|without|do not|don't|no more than|at most|at least|limit|constraint|keep it|in \d+ words?)\b/i,
    /\d+\s*(?:words?|chars?|字|页|行)/i,
  ],
  'output-format': [
    /(?:输出|交付|呈现|格式|表格|列表|清单|大纲|要点|报告|邮件|文档|代码|段落|json|markdown|csv)/i,
    /\b(?:output|format|table|list|bullet|outline|report|email|document|snippet|json|markdown|section|paragraph|csv)\b/i,
    /```[\s\S]*?```/,
  ],
  acceptance: [
    /(?:验收|成功标准|质量标准|通过|检查|测试|确保|确认|符合|满足|完成标准|可用)/,
    /\b(?:acceptance|success criteria|criteria|verify|validate|test|ensure|check|pass|done when|definition of done|usable)\b/i,
  ],
  'time-scope': [
    /(?:截止|期限|工期|交付时间|时间范围|本周|上周|下周|本月|下月|今天|明天|后天|今晚|之前完成|小时|天内|周内|个月内)/,
    /\b(?:deadline|due|by (?:today|tomorrow|eod|end of|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|within \d+ (?:hour|day|week|month)s?|today|tomorrow|this week|next week|this month|time range|timeline)\b/i,
    /\d+\s*(?:天|周|个月|小时)(?:内|之内|以内)?/,
  ],
};

/**
 * Count UTF-8 bytes without relying on `Buffer` or `TextEncoder`.
 * @param {unknown} input text to measure
 * @returns {number} byte length, 0 for non-strings
 */
export function utf8Length(input) {
  if (typeof input !== 'string') return 0;
  let bytes = 0;
  for (const char of input) {
    const codePoint = char.codePointAt(0);
    if (codePoint < 0x80) bytes += 1;
    else if (codePoint < 0x800) bytes += 2;
    else if (codePoint < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/**
 * Remove zero-width characters that silently break matching and copy/paste.
 * @param {unknown} input text to clean
 * @returns {string} cleaned text, '' for non-strings
 */
export function stripZeroWidth(input) {
  return typeof input === 'string' ? input.replace(ZERO_WIDTH_RE, '') : '';
}

/**
 * Cut text at a code-point boundary so that it fits a UTF-8 byte budget.
 * A surrogate pair is never split; the first code point that would overflow
 * is dropped together with everything after it.
 * @param {unknown} input text to cut
 * @param {number} maxBytes byte budget
 * @returns {CutResult} cut text, its byte length, and whether anything was dropped
 */
export function truncateToBytes(input, maxBytes) {
  if (typeof input !== 'string') return { text: '', bytes: 0, truncated: false };
  const limit = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : Number.POSITIVE_INFINITY;
  let bytes = 0;
  let text = '';
  for (const char of input) {
    const size = utf8Length(char);
    if (bytes + size > limit) return { text, bytes, truncated: true };
    text += char;
    bytes += size;
  }
  return { text, bytes, truncated: false };
}

/**
 * Normalize raw input: strip zero-width chars, unify newlines, trim trailing
 * spaces, collapse runs of more than two blank lines (outside fenced code
 * blocks), then cap the result on a code-point boundary.
 * @param {unknown} raw caller input
 * @param {{ maxInputBytes?: number }} [options] byte cap, defaults to 8000
 * @returns {NormalizedInput} normalization result; `ok:false` for empty input
 */
export function normalizeInput(raw, options = {}) {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'not-string', text: '', originalChars: 0, originalBytes: 0, chars: 0, bytes: 0, truncated: false };
  }
  const maxBytes = Number.isFinite(options.maxInputBytes) && options.maxInputBytes > 0
    ? Math.floor(options.maxInputBytes)
    : DEFAULT_MAX_INPUT_BYTES;
  const text = tidyText(stripZeroWidth(raw));
  if (text.length === 0) {
    return { ok: false, reason: 'empty', text: '', originalChars: 0, originalBytes: 0, chars: 0, bytes: 0, truncated: false };
  }
  const originalChars = [...text].length;
  const originalBytes = utf8Length(text);
  const cut = truncateToBytes(text, maxBytes);
  return {
    ok: true,
    text: cut.text,
    originalChars,
    originalBytes,
    chars: [...cut.text].length,
    bytes: cut.bytes,
    truncated: cut.truncated,
  };
}

/**
 * Count CJK characters and Latin letters, used to resolve a mixed-language text.
 * @param {unknown} input text to inspect
 * @returns {{ cjk: number, latin: number }} script counts
 */
export function countScripts(input) {
  const text = typeof input === 'string' ? input : '';
  return {
    cjk: (text.match(CJK_RE) ?? []).length,
    latin: (text.match(LATIN_RE) ?? []).length,
  };
}

/**
 * Detect the dominant language of a text with a script-ratio heuristic.
 * @param {unknown} input text to inspect
 * @returns {DetectedLanguage} 'zh', 'en', or 'mixed'
 */
export function detectLanguage(input) {
  const text = typeof input === 'string' ? input : '';
  const { cjk, latin } = countScripts(text);
  if (cjk + latin === 0) return 'en';
  const ratio = cjk / (cjk + latin);
  if (ratio >= 0.6) return 'zh';
  if (ratio <= 0.2) return 'en';
  return 'mixed';
}

/**
 * Classify the request into a coarse intent bucket.
 * @param {unknown} input text to classify
 * @returns {IntentResult} intent, a 0-1 confidence, and the matched signals
 */
export function classifyIntent(input) {
  const text = typeof input === 'string' ? input : '';
  if (text.trim().length === 0) return { intent: 'other', confidence: 0.15, signals: [] };
  const scored = INTENT_ORDER.map((intent) => ({ intent, ...countIntentHits(intent, text) }));
  let best = scored[0];
  for (const entry of scored) {
    if (entry.hits > best.hits) best = entry;
  }
  if (best.hits === 0) return { intent: 'other', confidence: 0.15, signals: [] };
  const second = scored
    .filter((entry) => entry.intent !== best.intent)
    .reduce((max, entry) => Math.max(max, entry.hits), 0);
  const confidence = Math.round(
    Math.min(0.95, 0.35 + 0.1 * Math.min(best.hits, 5) + 0.05 * Math.max(0, best.hits - second)) * 100,
  ) / 100;
  return { intent: best.intent, confidence, signals: best.signals.slice(0, 6) };
}

/**
 * Score how specific a request is and list the dimensions it is missing.
 * The score is monotone non-decreasing when extra detail is appended to the
 * text, which makes it usable as a "before/after" quality indicator.
 * @param {unknown} input text to score
 * @returns {SpecificityResult} integer score 0-100, missing dimensions, signals
 */
export function scoreSpecificity(input) {
  const text = typeof input === 'string' ? input : '';
  if (text.trim().length === 0) {
    return { score: 0, missing: [...SPECIFICITY_DIMENSIONS], signals: [] };
  }
  const signals = [];
  for (const dimension of SPECIFICITY_DIMENSIONS) {
    const signal = firstHit(DIMENSION_PATTERNS[dimension], text);
    if (signal !== null) signals.push({ dimension, signal });
  }
  const present = new Set(signals.map((item) => item.dimension));
  const missing = SPECIFICITY_DIMENSIONS.filter((dimension) => !present.has(dimension));
  const chars = [...text].length;
  const coverage = (present.size / SPECIFICITY_DIMENSIONS.length) * 70;
  const detail = Math.min(1, chars / 300) * 15;
  const spread = Math.min(1, signals.length / SPECIFICITY_DIMENSIONS.length) * 15;
  const score = Math.round(Math.min(100, coverage + detail + spread));
  return { score, missing, signals };
}

/**
 * Collapse blank-line runs (outside fenced code) and trim trailing spaces.
 * Internal helper; exported indirectly through {@link normalizeInput}.
 * @param {string} text text to tidy
 * @returns {string} tidied text
 */
function tidyText(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let fence = '';
  let blankRun = 0;
  for (const line of lines) {
    const fenceMatch = FENCE_RE.exec(line);
    const insideFence = fence !== '';
    if (fenceMatch) {
      const marker = fenceMatch[1].charAt(0);
      if (!insideFence) fence = marker;
      else if (marker === fence) fence = '';
    }
    if (insideFence) {
      out.push(line);
      blankRun = 0;
      continue;
    }
    const trimmed = line.replace(/[ \t]+$/, '');
    if (trimmed.length === 0) {
      blankRun += 1;
      if (blankRun > 2) continue;
    } else {
      blankRun = 0;
    }
    out.push(trimmed);
  }
  return out.join('\n').trim();
}

/**
 * Count weighted keyword hits for one intent.
 * @param {IntentId} intent intent bucket
 * @param {string} text text to scan
 * @returns {{ hits: number, signals: string[] }} weighted hit count and matched keywords
 */
function countIntentHits(intent, text) {
  const lexicon = INTENT_LEXICON[intent];
  let hits = 0;
  const signals = [];
  for (const keyword of lexicon.zh) {
    const count = countOccurrences(text, keyword, false);
    if (count > 0) {
      hits += Math.min(count, 3);
      signals.push(keyword);
    }
  }
  for (const keyword of lexicon.en) {
    const count = countOccurrences(text, keyword, true);
    if (count > 0) {
      hits += Math.min(count, 3);
      signals.push(keyword);
    }
  }
  return { hits, signals };
}

/**
 * Count substring occurrences, honoring word boundaries for Latin keywords.
 * @param {string} text haystack
 * @param {string} keyword needle
 * @param {boolean} latin whether to require word boundaries
 * @returns {number} occurrence count
 */
function countOccurrences(text, keyword, latin) {
  if (!keyword) return 0;
  if (latin) {
    const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'gi');
    return (text.match(pattern) ?? []).length;
  }
  let count = 0;
  let index = text.indexOf(keyword);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(keyword, index + keyword.length);
  }
  return count;
}

/**
 * Return the first regex match in a probe list, clipped for display.
 * @param {RegExp[]} patterns probes to try in order
 * @param {string} text text to scan
 * @returns {string | null} matched snippet, or null
 */
function firstHit(patterns, text) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return [...match[0]].slice(0, 24).join('');
  }
  return null;
}

/**
 * Escape a literal string for use inside a RegExp.
 * @param {string} value literal
 * @returns {string} escaped literal
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
