# Enhanced-prompt engine (`lib/`)

Deterministic, offline rewrite engine — the `strategy: 'rule'` path and the standalone
CLI. The default `strategy: 'llm'` path calls the model instead (`lib/llm.js`). Given a
vague request this engine renders a structured, ready-to-send markdown prompt plus the
ordered section list. No network, no model calls, no third-party dependencies.

```js
import { enhance } from './lib/engine.js';

const result = enhance('帮我写个周报', { preset: 'auto' });
```
## Modules

| File | Role |
| --- | --- |
| `analysis.js` | input normalization, language detection, intent classification, specificity scoring |
| `preset-copy.js` | section copy, zh/en titles and guidance, deterministic filler heuristics |
| `presets.js` | preset registry, auto-selection rules, serializable metadata |
| `engine.js` | `enhance(raw, config)`, config normalization, composition, warnings |

`engine.js` imports only `./analysis.js` and `./presets.js`; `presets.js`
imports only `./preset-copy.js`. Nothing else.

## API

- `enhance(raw, config?) -> result` — main entry point.
- `normalizeConfig(config) -> { ok: true, config, warnings: [] } | { ok: false, error }`
- Constants/metadata: `DEFAULT_CONFIG`, `PRESET_IDS`, `WARNING_CODES`, `HARD_INPUT_BYTES`, `describePresets()`.
- `analysis.js`: `normalizeInput`, `detectLanguage`, `classifyIntent`, `scoreSpecificity`, `truncateToBytes`, `utf8Length`, `stripZeroWidth`, `countScripts`, `DEFAULT_MAX_INPUT_BYTES`, `INTENT_IDS`, `SPECIFICITY_DIMENSIONS`.
- `presets.js`: `PRESETS`, `getPreset`, `selectPreset`, `describePresets`, `placeholder`, `PLACEHOLDER_ZH`, `PLACEHOLDER_EN`, `DEFAULT_PRESET`, `AUTO_CONFIDENCE_THRESHOLD`.
## Result

```js
{ ok: true, original, enhanced, sections: [{ key, title, body }],
  meta: { preset, presetSource, language, detectedLanguage, intent,
          intentConfidence, specificityBefore, specificityAfter,
          originalChars, enhancedChars, truncated, strategy,
          originalPreserved, elapsedMs },
  warnings: [] }
```

`meta.preset` is never `auto`; `meta.presetSource` is `explicit` or `auto`;
`meta.elapsedMs` is always `0` (measured by the Host). On failure:
`{ ok: false, error: { code, message } }` with `empty-input`, `too-long`, or
`invalid-config`.

## Config

| Key | Default | Notes |
| --- | --- | --- |
| `preset` | `'auto'` | preset id or `auto`; unknown ids fall back with `preset-fallback` |
| `language` | `'auto'` | `auto` / `zh` / `en`; invalid values fall back silently |
| `maxInputBytes` | `8000` | 16..262144; cut on a code-point boundary -> `input-truncated` |
| `maxOutputBytes` | `16000` | 256..1000000; cut on a code-point boundary -> `output-truncated` |
| `includeOriginal` | `false` | prepends exactly one original block; sections omit the raw line |
| `tone` | `'standard'` | `concise` / `standard` / `detailed` verbosity |
| `context` | `{}` | caller facts: `cwd`, `workspace`, `date`, `goal`, `files`; never read from the clock |

Auto rule: `standard` by default; a classified intent with confidence >= 0.6
selects `code` for code, and `goal-oriented` for writing / planning / data.
## Presets

| Id | Default | Sections (zh) |
| --- | --- | --- |
| `standard` | yes | 角色 / 背景 / 任务拆解 / 输出格式 / 约束 / 验收标准 |
| `six-section` | no | 目标 / 输入 / 动作 / 约束 / 输出 / 验收 |
| `goal-oriented` | no | 目标 / 背景 / 交付物 / 约束 / 成功标准 |
| `concise` | no | 目标 / 动作 / 输出 (three lines) |
| `code` | no | 角色 / 任务 / 约束 / 验收标准 |

`six-section` is adopted from public human-facing prompt-writing guidance; it
is not a vendor output schema and is not described as one.

## Guarantees and warning codes

Deterministic (identical input -> byte-identical output), offline, pure ESM
for Node >= 18 (`.js` needs `"type": "module"` or an ESM loader). Unknown facts
render as `（待补充）` / `(to fill in)` instead of invented content. Output is
plain markdown: no HTML, no emoji. Stable warning codes: `input-truncated`,
`output-truncated`, `facts-marked-unknown`, `preset-fallback`.
