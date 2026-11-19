# 安装与验证记录

- 验证时间：2026-11-18（Asia/Shanghai）
- 宿主：DSH NEXT Desktop `2.0.21-next`，Harness 包 `0.2.1-rc.4`
- Profile：`desktop`（`C:\Users\16001\.dsh\profiles\desktop`）
- 版本沿革：`v1.0.0` 安装 → `v1.0.1` 上下文/错误文案 → `v1.0.3` `agent.steer` 消息形状 →
  `v1.0.4` 审查收尾 → `v1.0.5` `maxBytes` 硬校验 + 预览层级/语言/版本行 → `v1.1.0` 输入框「增强」按钮
（浏览器半边） → `v1.1.1` 按钮改到输入框控件行、模型选择器左侧（28×28 图标按钮） →
  `v1.2.0` 默认改为 `ctx.llm` 真模型改写：新增 `lib/llm.js`、`POST /enhance/api` 桥、按钮忙碌/错误态 →
  `v1.2.1` 输出形态改为「提示词正文」：不分节、不列提纲、不引用原文、不写占位符，限长 200–300 字 →
  `v1.3.0` 会话上下文（`ctx.sessions`）+ 插件内 ⚙ 设置面板与设置文件 →
  `v1.3.1` 面板选项中文化 + 打开时用生效值（含默认）预填 →
  **`v1.4.0` 开源仓库化：仓库根 = 可安装 bundle（支持 `github:` 直装）+ 一行安装器 + CI/社区文件**
- 最终状态：静态树与线上代际一致（`package.json` = `index.js` = `1.4.0`）；单测 85/85 通过

---

## 1. 静态与单元验证

```text
cd workbuddy-prompt/plugin
node --test
ℹ tests 59
ℹ pass 59
ℹ fail 0
```

拆分：引擎 `test/engine.test.mjs` 24 例 + `test/engine-presets.test.mjs` 8 例 + Host 装配
`test/host.test.mjs` 20 例 + 浏览器 bundle `test/client.test.mjs` 7 例。

覆盖点：

| 类别 | 覆盖 |
| --- | --- |
| 引擎 | zh/en/mixed 语言、空输入、码点边界截断（含 CJK + emoji）、5 套模板、auto 模板选择、确定性（两次调用逐字节相同）、占位符、具体度单调性、非法配置回退、稳定警告码 |
| Host 装配 | 配置默认值/越界钳制/枚举回退/名称语法回退、命令语法（help/status/apply/preset/lang/错误）、预览渲染（h1 标题、版本行、双语警告）、apply 提交带 UUID + `role:'user'` 的 `UserMessage`、连续 apply 不撞 id、allowApply=false 降级、无 agent/抛错降级、status/help 双语、工具 JSON Schema 形状与回放安全、会话工作目录注入、Harness 内部路径过滤、无服务时不注入 cwd、工具/命令错误文案分离、`maxBytes` 硬校验（超限/越界/正常）、三类能力注册（mock ctx）、能力开关与自定义名称、注册失败不抛出、引导段文案随配置变化 |
| 浏览器 bundle | 构建产物新鲜度（`--check`）、槽位注册（name/id/order）、仅 require `react`、内联引擎与 Host 引擎对 5 组输入逐字节一致、空草稿隐藏、点击原地替换草稿、恢复原文写回精确原文、编辑结果后收回恢复按钮、无 fetch/DOM/localStorage/node 内建 |

其他静态检查：

- `node --check`：`index.js`、`bin/install.mjs`、`bin/enhance.mjs`、`lib/*.js` 全部通过（ESM）；
- `package.json`：`"type": "module"`、`dsh.bundle.patch`、`exports` 含 `./locale/*.json` 与 `./icon`、
  `files` 覆盖运行期文件；
- 全部 JSON 可解析、`icon.svg` 可被 XML 解析（767 B）、无 BOM、无 CRLF；
- `locale/{en,zh}.json` 含 `meta.title` / `meta.description`，中文正确。

---

## 2. 安装验证

```text
cd workbuddy-prompt/plugin
node bin/install.mjs install --profile desktop
backup: C:\Users\16001\.dsh\plugins\.backup-dsh-enhanced-prompt-2026-11-18T04-32-07-595Z
plugin link created: C:\Users\16001\.dsh\plugins\dsh-enhanced-prompt -> ...\workbuddy-prompt\plugin
profile link created: C:\Users\16001\.dsh\profiles\desktop\node_modules\dsh-enhanced-prompt -> ...\workbuddy-prompt\plugin
```

```text
node bin/install.mjs status --profile desktop --json
{
  "dependency": "link:../../plugins/dsh-enhanced-prompt",
  "bundleSelected": true,
  "bundlePosition": 4,
  "pluginLink": { "exists": true, "target": "...\\workbuddy-prompt\\plugin" },
  "profileLink": { "exists": true, "target": "...\\workbuddy-prompt\\plugin" },
  "patchBlock": "present"
}
```

profile `dsh.profile.bundles`：

```json
["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
 "@deepseek-ai/dsh-experimental-agent-team-profile",
 "@deepseek-ai/dsh-experimental-inspector-profile", "dsh-enhanced-prompt"]
```

---

## 3. 线上激活（HMR，无需重启）

安装写盘后 HMR 监听 profile 清单与 patch 变化，自动重组合并启动新 bundle。Host 日志
`C:\Users\16001\.dsh\logs\desktop-next.log`（首次安装，v1.0.0）：

```text
2026-11-18T04:32:09.766Z [info] [enhanced-prompt] activated v1.0.0 preset=auto lang=auto caps=8000/16000B command=on tool=on guidance=on@5150<45
2026-11-18T04:32:09.769Z [info] [enhanced-prompt] registered command /enhance
2026-11-18T04:32:09.771Z [info] [enhanced-prompt] registered tool enhance_prompt
2026-11-18T04:32:09.771Z [info] [enhanced-prompt] registered prompt section enhanced-prompt:guidance at order 5150
```

这四条同时证明：bundle 被 loader 解析、插件模块被 import、`ctx.inject` 三个能力全部就绪、
行配置（含 profile patch 覆盖块）被正确采纳。

---

## 4. 模型侧端到端（v1.0.0）

用一个**新开的子会话**调用工具（子会话在插件注册之后创建，工具目录由 Host 重新装配）：

| 检查 | 结果 |
| --- | --- |
| 工具是否可见 | 可见：`enhance_prompt`，参数 `{prompt, preset?, language?, tone?, maxBytes?}`；系统提示中同时出现 `## Enhanced prompt` 引导段（证明提示段也生效） |
| 调用 `{"prompt":"帮我写个周报","preset":"standard","language":"zh"}` | 成功返回 46 行 Markdown：标题行、`> 原始请求`、角色/背景/任务拆解/输出格式/约束/验收标准、元信息行、警告行；未指定信息全部为「（待补充）」 |
| 确定性 | 同参数第二次调用与第一次逐字符相同 |
| 空输入 `{"prompt":"   "}` | 优雅失败，返回 `Error: Empty input: put the request after the command.`，无异常栈 |
| 命令面 | 子会话不可达（agent 侧没有命令列表工具），只能由 GUI 人工确认 |

**发现并修复的 2 个缺陷（v1.0.1）**：

1. 上下文目录取了 `process.cwd()`，在 Desktop Host 里是 `~/.dsh/profiles/desktop`，把 profile
   路径写进了模型可见提示词；
2. 工具空输入复用了命令文案（“写在命令后面”），对模型不适用。

修复后热替换（文件变更 + patch 内容变化触发重组合）到 v1.0.1，日志：

```text
2026-11-18T04:36:33.601Z [info] [enhanced-prompt] activated v1.0.1 preset=auto lang=auto caps=8000/16000B command=on tool=on guidance=on@5150<45
```

再次用新子会话复验：

| 检查 | 结果 |
| --- | --- |
| 工作目录 | `工作目录：C:\Users\16001\Documents\deepseek-harness\default-workspace`、`工作区：default-workspace`、`参考日期：2026-11-18`；全文无 `desktop` / `.dsh` 路径 |
| 空输入错误 | `Error: empty or blank input: pass the raw request in the "prompt" field`；含 `prompt`、不含 `command` |
| code 模板分节 | `## 角色 / ## 任务 / ## 约束 / ## 验收标准` |

---

## 5. 独立审查发现：`agent.steer` 的消息形状（v1.0.3）

独立审查（[review.md](./review.md)）对照安装后的类型契约发现：`agent.steer()` 接受的是完整的
`UserMessage`，而此前传入的是 `{ content, source }` 裸对象，缺少 `id` 与 `role: 'user'`。

证据链：

- `dsh-agent-loop/lib/index.js` 的 `steer(input)` → `inbox.splice(..., [input])`，收件箱按
  `message.id` 去重（`if (ids.has(message.id)) throw new Error('message "<id>" is already pending')`），
  缺 `id` 会让第二次 pending apply 抛错；
- 第一方生产者全部使用 `createUserMessage()`（如 `dsh-plan-mode`、`dsh-command-goal`）；
- `dsh-llm` 的 `createUserMessage(input)` = `{ ...input, role: 'user', id: brandString(randomUUID()) }`，
  而 `dsh-brand` 的 `brandString()` 在运行时是恒等函数（只做编译期品牌）——因此
  `{ id: randomUUID(), role: 'user', content, source }` 就是完整的运行期形状。

修复：新增 `createUserMessage(text)` 构造器，`/enhance apply` 改为
`agent.steer(createUserMessage(...))`；单测断言 `role === 'user'`、UUID 形状、连续两次 apply 的
`id` 不同。热替换到 v1.0.3：

```text
2026-11-18T04:42:35.087Z [info] [enhanced-prompt] activated v1.0.3 preset=auto lang=auto caps=8000/16000B command=on tool=on guidance=on@5150<45
```

审查复验：`steer` 消息含 UUID/role/source，UUID 唯一，单测覆盖；静态与线上代际一致。

> `/enhance apply` 仍无法从 agent 会话触发（没有命令执行面），该路径由「单测 mock + 第一方调用点
> 比对 + 类型契约」三重佐证，GUI 人工执行一次即可闭环。

---

## 6. 审查收尾项（v1.0.4）

| 审查项 | 处理 | 验证 |
| --- | --- | --- |
| F3 `[spec-violation, process]` 手写 profile 安装 vs `install_bundle` | 无法用 `plugin_manager`（当前预设未启用）；在 design.md §10.2 明确记录这是等价回退路径与适用条件；安装器改为**原子写**（临时文件 + rename），托管块整块重写 | 重装后 profile patch 无 BOM/无 CRLF、单块、Host 正常重载 |
| F4 `[risk]` 产品名出现在包元数据 | `package.json` 描述、`index.js` 头注释、`locale/{en,zh}.json` 改为中性文案；产品名只保留在**文档**中作对照性事实提及，并修正 README 合规表述 | 包内检索仅剩对照说明与「生成文本不得含该词」的测试断言 |
| F5 `[risk]` cwd 回退可能泄漏宿主路径 | 删除 `process.cwd()` 回退：`workingDirectory` 服务缺失时**不注入任何 cwd** | 新增单测：无服务时输出不含 `process.cwd()` |
| F6 `[nit]` 同时导出 named `apply` 与 default 对象 | 删除 default 导出，只保留 `export function apply` + `name` | 能力注册正常 |
| F7 `[nit]` 模块级可变 `configWarnings` | 改为 `normalizeConfigResult()` 返回 `{config, warnings}`，`apply` 用局部变量 | 新增单测：非法配置出现在激活日志 |
| F10 `[nit]` 命令名未校验语法 | 命令名/工具名按正则校验，非法回退并告警 | 新增单测覆盖合法/非法名与告警 |
| F8 `[nit]` 裸 `ctx.tools.register` 而非 `defineTool`；F9 `[nit]` render 回放 | 在 design.md §4 记录等价性与零依赖取舍；render 对 `undefined`/旧值安全回退 | `node --check` + 回放单测 |

热替换到 v1.0.4：

```text
2026-11-18T04:46:44.016Z [info] [enhanced-prompt] activated v1.0.4 preset=auto lang=auto caps=8000/16000B command=on tool=on guidance=on@5150<45
```

---

## 7. 最终回归发现的问题（v1.0.5）

v1.0.4 的独立子会话回归（4 通过 / 1 失败）发现：

| 问题 | 说明 | 处理 |
| --- | --- | --- |
| **`maxBytes` 未真正生效（高）** | 参数被钳制进 16..60000 后直接当作输入上限，`maxBytes:1` + 6 字节输入仍然成功，等于静默忽略调用方的限制 | 改为**硬校验**：范围外直接报 `invalid maxBytes … supported range is 16–60000 bytes`；范围内输入字节数超限则报 `input is N UTF-8 bytes; the requested maxBytes limit is M`，不再静默截断 |
| 预览标题层级倒置（中） | 标题是 `###`（h3），其下分节是 `##`（h2），子级高于父级 | 标题改为 `#`（h1） |
| 英文警告用了全角冒号（低） | `Note：…`（U+FF1A） | 英文用 `Note: `，中文保留 `注意：` |
| 输出不含版本号（提示） | 无法从输出确认线上代际 | 元信息行追加 `· v1.0.5` |
| 中文写作意图漏检（低） | `复盘` 等词未命中 writing | 扩充中文写作词表（复盘/汇报/纪要/提纲） |

修复后 52/52 单测通过，热替换到 v1.0.5：

```text
2026-11-18T04:48:29.794Z [info] [enhanced-prompt] activated v1.0.5 preset=auto lang=auto caps=8000/16000B command=on tool=on guidance=on@5150<45
2026-11-18T04:48:29.799Z [info] [enhanced-prompt] registered command /enhance
2026-11-18T04:48:29.801Z [info] [enhanced-prompt] registered tool enhance_prompt
2026-11-18T04:48:29.802Z [info] [enhanced-prompt] registered prompt section enhanced-prompt:guidance at order 5150
```

最终回归（新子会话，四项全过）：

| 检查 | 实测原文 |
| --- | --- |
| h1 标题 + h2 分节 | 首行 `# 增强提示词 · standard · zh`；分节 `角色 → 背景 → 任务拆解 → 输出格式 → 约束 → 验收标准` |
| 版本行 | `原输入 8 字 · 具体度 15 → 100 · writing · v1.0.5` |
| `maxBytes` 超限 | `Error: input is 45 UTF-8 bytes; the requested maxBytes limit is 16` |
| `maxBytes` 越界 | `Error: invalid maxBytes 1: the supported range is 16–60000 bytes` |
| 英文警告冒号 | `Note: some facts were left as explicit placeholders`（无 `Note：`） |
| 工作目录 | `工作目录：C:\Users\16001\Documents\deepseek-harness\default-workspace`，全文无 `.dsh` / `profiles` / `desktop` |

---

## 7.5 客户端按钮（v1.1.1）

实现依据（全部来自安装版源码，详见 [client-api-recon.md](./client-api-recon.md)）：

| 需要 | 使用的 API | 证据 |
| --- | --- | --- |
| 槽位 | `ctx.slots.register({ name: 'conversation.input.right', id, order }, Component)`——渲染在模型选择器**之前**，即控件行里紧邻模型按钮 | dsh-client-ui-conversation/lib/client.js:19283、20121 |
| 读草稿 | `useInput((s) => s.draft)`（InputState 的 selector hook） | 同上 :19918、:15719-15730 |
| 写草稿 | `inputActions.setDraft(text)`（自发布、自持久化） | 同上 :14946-14972、:15042-15053 |
| 会话 id | `sessionId` 标准 prop | dsh-client-ui-session/lib/client.js:758,762 |
| 撤销 | `setDraft` 是 history-merge，不可撤销；插件自建「恢复原文」 | 同上 :7500 |

构建与验证：

```text
cd workbuddy-prompt/plugin
node scripts/build-client.mjs           # 生成 client.js（约 11.6 KB；v1.2.0 起只含 UI，不含引擎）
node scripts/build-client.mjs --check   # client.js is up to date
node --test                             # 72/72 通过（含浏览器 bundle 8 例、LLM/桥 12 例）
```

`test/client.test.mjs` 用 fake `window.__ModuleLoader__` + 最小 React 桩 + 注入式 `fetch` 驱动组件，已验证：

- 空草稿 → 组件返回 `null`（不渲染）；
- 点击「增强」→ 恰好一次 `POST /enhance/api`，body 含 `op/text/sessionId`，成功后 `setDraft` 收到模型返回值；
- 请求进行中 → 按钮 `disabled` 且 `aria-busy=true`；
- 请求失败 → 草稿一字未动，按钮旁出现可悬停的错误提示；
- 「恢复原文」→ 写回与增强前**逐字符相同**的草稿，随后按钮消失；
- 手动编辑增强结果后 → 「恢复原文」自动收回（不覆盖用户编辑）；
- bundle 内无 `document` / `localStorage` / `node:` / ESM import，且只 `require('react')`。

线上状态：Host 于 `05:07:11.106Z` 重载到 `v1.1.1`，日志四条注册行齐全；`package.json` 的
`dsh.client`（platform web）与 `exports["./client"]` 已就位，`client.js` 由构建脚本生成并通过新鲜度检查。

**未自动验证的部分**：浏览器里的实际渲染与点击。客户端模块图由 Host 在启动时扫描 `dsh.client`
清单，且 HMR 明确不监听 `package.json` 变化，所以**首次需要刷新页面**（Ctrl+R / Cmd+R）；
若刷新后仍无按钮则重启 DSH。GUI 视觉与交互的最终确认需人工完成（本会话没有浏览器控制）。

---

## 7.6 v1.2.0：真模型改写（LLM 路径）

### 7.6.1 为什么改

用户要求「输入文字后点增强，必须用 AI 改写并回填输入框，花 token 也可以，不要离线规则」。
于是默认 `strategy` 从 `rule` 改为 `llm`：Host 侧通过 `ctx.llm` 调一次模型，浏览器按钮只负责
发请求与回填；离线引擎降级为显式 `strategy: 'rule'` 选项（不静默顶替）。

### 7.6.2 实现锚点（安装版源码实证）

| 需要 | API | 证据 |
| --- | --- | --- |
| 调模型 | `ctx.llm.stream({ provider, model, messages, system, maxTokens, signal })`，只消费 `text-delta` 块 | dsh-llm/lib/index.js:977、:1275、:1437；`system` 由适配器消费（dsh-llm-pi-ai/lib/index.js:1275） |
| 路由 | `ctx.agentDefaultModel.currentSelection()` → `{provider, model}` | dsh-agent-default-model/lib/index.js:36-43 |
| 超时/中止 | 自建 `AbortController` + `signal` 透传；`finish.kind === 'error'/'aborted'` 映射错误码 | dsh-llm/lib/index.js:1103、:2406 |
| 服务访问 | 必须 `ctx.inject([...], scope => …)`；裸读 `ctx.llm` / `ctx.agentDefaultModel` 抛 `cannot get property … without inject` | 本机日志（两次真实失败，见 7.6.4） |
| 桥 | `ctx.webServer.register({ kind:'exact', path:'/enhance/api', handler })` | [bridge-recon.md](./bridge-recon.md) |

### 7.6.3 真机验证结果

```text
[05:20:43.171Z] activated v1.2.0 strategy=llm route=magpie/ollama/deepseek-v4.1-flash:1017(default) …
[05:20:43.174Z] registered command /enhance
[05:20:43.174Z] registered tool enhance_prompt
[05:20:43.175Z] registered prompt section enhanced-prompt:guidance at order 5150
[05:20:43.175Z] registered bridge POST /enhance/api
```

`POST /enhance/api {"op":"enhance","text":"帮我写个周报"}` 实测：

```json
{"ok":true,"enhanced":"> 原始请求：帮我写个周报\n\n## 角色 / Role …","meta":{"provider":"magpie","model":"ollama/deepseek-v4.1-flash:1017","routeSource":"default","elapsedMs":2309,"chars":675}}
```

即：**一次真实模型调用，2.3 秒返回 675 字结构化中文提示词**，含角色/背景/任务拆解/输出格式/约束/验收
六节与「（待补充）」占位——与浏览器按钮走的是同一条链路。

单测 85/85 通过（引擎 32 + Host 20 + 浏览器 8 + LLM/桥 12）。新增覆盖：

- `resolveRoute`：配置优先 → 默认模型 → 无路由；
- 系统提示含「不得编造/占位符/输出仅 Markdown」，`includeOriginal` 开关注入对应指令；
- 流式拼接 `text-delta`、`finish.kind=error` → `provider-error`、自建超时 → `timeout`；
- `cleanModelOutput` 只剥围栏与前缀；
- 桥：405/415/403/400/404/413/429/502 各状态、`ping` 与 `enhance` 响应形状、同会话并发 429。

### 7.6.4 过程中发现的两个真实缺陷（已修）

1. `resolveRoute` 里裸读 `ctx.agentDefaultModel` → Cordis 抛
   `cannot get property "agentDefaultModel" without inject`，整个插件 `did not activate`。
   修复：服务只在 `ctx.inject(['agentDefaultModel'], scope => …)` 内获取；`resolveRoute` 对裸读取
   也加 try/catch 兜底。
2. `callModel` 用外层 `ctx` 访问 `ctx.llm` → 桥请求返回 `502 {"error":{"code":"provider-error","message":"cannot get property \"llm\" without inject"}}`。
   修复：`ctx.inject(['llm'], scope => …)` 捕获服务，改写只拿 `{ llm: scope.llm }` 这个最小门面。

这两次都是「服务必须经 inject 访问」这一 Cordis 规则的真实体现，也说明桥的端到端验证是必要的——
单测里 fake ctx 不会暴露该约束。

---

## 7.7 v1.2.1：输出形态改为「提示词正文」

用户反馈：点增强后输入框里出现的是「提示词优化文档」（带 `## 角色 / ## 背景 / ## 任务拆解` 分节、
`（待补充）` 占位、`> 原始请求：…` 引用），而他要在输入框里直接拿到**改写好的提示词本身**，能立刻发送。

改法（只动 Host 侧模型指令，客户端无需改动）：

- `buildSystemPrompt()` 重写：只输出提示词正文，第一人称对 AI 说话；禁止标题/分节/提纲/原文引用/
  占位符/代码块；缺信息就让提示词里要求 AI 先问；限长中文约 200–300 字、英文约 150 词。
- `buildMessages()` 改为 `Rewrite this request into one prompt I can send right away:`。
- `cleanModelOutput()` 增补中文前缀（`优化后的提示词：` 等）。
- `includeOriginal` 只对引擎（`strategy:'rule'`）生效，模型路径不再引用原文。

前后对比（同一输入「帮我写个周报」）：

| | v1.2.0（675 字，文档形态） | v1.2.1（200 字，提示词正文） |
| --- | --- | --- |
| 开头 | `> 原始请求：帮我写个周报` + `## 角色 / Role` | `帮我写一份本周周报（今天是 2026 年 11 月 18 日）。…` |
| 结构 | 六个 Markdown 分节 + 占位符 | 一整段自然语言，无分节 |
| 可否直接发送 | 需要自己删占位、补信息 | 可直接发送（缺信息时已要求 AI 先问） |
| 耗时 | 2309 ms | 2989 ms |

真机验证（`POST /enhance/api`，`magpie/ollama/deepseek-v4.1-flash:1017`）：

```text
status=200 ok=True ms=2989 chars=200
帮我写一份本周周报（今天是 2026 年 11 月 18 日）。我手上还没有整理好的素材，所以先不要动笔：
请一次问我几个关键问题——本周主要做了哪几件事、每件事做到什么程度、有没有卡点或风险、
下周计划做什么、这份周报交给谁看、希望多长。等我回答后，你再按常见的周报结构把内容整理成
一篇可以直接发出去的正文，语言简洁客观，重点突出结果和进度，不要写成流水账；如果我有信息
没给全，就先问我，不要自行编造。
```

单测同步更新：`test/llm.test.mjs` 断言系统提示包含「只输出改写后的提示词正文 / 不要标题 / 约 200–300 字 /
第一人称」，且不含 `## 任务拆解`；`rewriteWithModel` 用例改为断言输出不以围栏开头、不含 `##`、不含「待补充」。
72/72 全绿。

### 7.6.5 附带事故：PowerShell ASCII 回写破坏 index.js 中文

定位注入问题时用 `Get-Content -Raw … | Set-Content -Encoding ASCII` 替换一处字符串，PS 5.1 以 ANSI
读入、ASCII 写出，把 `index.js` 中**所有中文与破折号**替换成 `?`（含字符串字面量与正则），文件语法随之
损坏。恢复方式：按行号区间用 Node 重写受影响的 20 余行（注释头、`LLM_ERROR_TEXT.zh`、`MESSAGES.zh`、
`WARNING_LABELS.zh`、`renderPreview` 中文分支、`parseCommandInput` 的正则/错误文案等），随后
`node --check` + 72/72 单测 + 线上日志三重确认。**教训：不要用 PS 5.1 做任何文本往返；只用
Node / 编辑器 / 本插件的安装器。**

---

## 8. 过程中的两次真实事故与恢复（记录在案）

### 8.1 profile patch 被 PowerShell 5.1 改坏

手工用 Windows PowerShell 5.1 修改 profile patch 时，`Get-Content -Raw` 以 ANSI 读取 UTF-8 文件、
`Set-Content -Encoding utf8` 回写，导致中文注释被二次编码并吞掉一个换行，YAML 出现
`duplicated mapping key`，HMR 报：

```text
[warn] config reload at ...\cordis.patch.yml failed
Error: ... failed to parse overlay ...: YAMLException: duplicated mapping key (248:3)
```

恢复：用 Node 从安装前基线（本交付内的 `rollback/desktop-cordis.patch.yml`，以及
`$DSH_HOME/plugins/.backup-*` 快照）重建 profile patch，重新追加托管块（UTF-8、无 BOM、LF），
再触发 HMR 重载成功。

### 8.2 本次文档被同一问题波及

在批量替换文档版本号时再次使用了 `Get-Content -Raw | Set-Content -Encoding UTF8`，导致
`README.md` / `docs/design.md` / `docs/verification.md` 的 UTF-8 中文被二次编码并出现不可逆字符丢失。
处理：三份文档按最终内容整体重写为 UTF-8（无 BOM、LF），并复核无替换字符；插件源码未受影响。

教训已写入 README 故障排查：**改文本文件时不要用 PowerShell 5.1 做读-改-写往返；用 UTF-8 编辑器
或 Node 脚本，安装器本身用 Node 写文件**。

---

## 7.8 v1.3.0：会话上下文 + 插件内设置

用户要求：改写要**按当前会话上下文**优化；插件要能在**插件里面自定义更多设置**。

### 7.8.1 会话上下文

- 客户端请求带 `sessionId`；Host 在 `ctx.inject(['sessions'])` 里拿 `sessions.get(id)`，
  调 `session.deriveMessages()`（宿主自己的模型可见投影），只取 `user`/`assistant` 的文本块，
  按 `history.messages`（默认 6）与 `history.chars`（默认 2000）从尾部裁剪，渲染成一个上下文块。
- 响应 meta 新增 `historyChars`，0 即「本次没有上下文」，便于观测与排障。
- 实测（live 会话 `fb1e884e…`）：输入「再短一点」→ `historyChars=2063`，输出提示词准确引用该会话的
  「739 行的规范文档、250–450 行目标区间」；关闭开关后同一请求 `historyChars=0`。
- 已归档（非 live）的会话 id 取不到上下文（`sessions.get` 只服务当前进程内的会话），返回 0——这也解释了
  第一次用旧会话 id 探测时的 0。

### 7.8.2 插件内设置

- 新增 `lib/settings.js`：设置写到 `$DSH_HOME/enhanced-prompt.settings.json`（原子写、**键白名单**），
  读取后与 profile 的静态配置 `mergeSettings()` 合并，再统一过 `normalizeConfig()`，所以手改文件也
  不会注入了非法 strategy/route。
- 面板键与会话配置键不同构，`mergeSettings()` 负责映射：`includeHistory → history.enabled`、
  `historyMessages → history.messages`、`historyChars → history.chars`。**这个映射最初漏了，被单测抓出来**
  （`historyMessages: 99` 期望 clamp 到 20，实际仍是默认 6）。
- 新增桥操作：`settings`（读）与 `saveSettings`（写，返回规范化后的值）；`ping` 现在回传实时 strategy。
- 客户端在 ✦ 旁新增 ⚙ 按钮，打开一个 `position: fixed` 面板（锚点取自齿轮自身 rect，Esc 关闭），
  字段：改写方式、风格、长度、语言、上下文开关/轮数/字数、provider/model、超时、额外要求。
- 命令侧同样可改：`/enhance settings` 查看，`/enhance set key=value` 写入。
- 实测：`saveSettings {length:'short'}` → 同一句「帮我写个周报」输出从 200 字降到 89 字；
  再切回 `normal` 恢复；`includeHistory:false → historyChars=0`，`true → 2063`。

### 7.8.3 验证结果

- 单测 **84/84**：引擎 32 + Host 20 + 浏览器 9 + LLM/桥 12 + 设置/历史 11。
  新增 `test/settings.test.mjs` 覆盖：路径解析、白名单与截断、原子写与损坏文件回退、深合并、扁平键映射、
  非法值回退、`/enhance set` 语法、`recentTurns` 只取文本并遵守预算、`renderHistory` 中英标签。
- 线上日志：`activated v1.3.0 strategy=llm style=natural/normal route=magpie/…(default) … history=on(6/2000) …
  bridge=/enhance/api settings=C:\Users\16001\.dsh\enhanced-prompt.settings.json`。
- 端到端 HTTP 实测（端口 60676）：`ping` / `settings` / `saveSettings` / `enhance` 四种 op 全部 200，
  响应形状与设计一致。

---

## 7.9 v1.3.1：面板中文标签 + 默认值预填

用户反馈两点：设置面板的下拉框里仍是 `llm` / `natural` / `short` 这类内部值；「会话上下文」等字段打开时是空白，
看不出默认值。

- **中文标签**：客户端新增 `OPTIONS`（值 → 本地化标签）：改写方式 = 模型改写（花 token）/ 离线规则引擎；
  输出风格 = 提示词正文 / 分节模板；长度 = 短 / 中 / 长；语言 = 自动识别 / 中文 / English。
  `option` 的 `value` 仍是规范值，保存不受影响；中英标签随 `navigator.language` 切换。
- **默认值**：桥的 `settings` op 现在返回 `{ settings: 生效值, overrides: 用户覆盖 }`——`settings` 由
  `describeSettings(cfg)` 生成，包含 `includeHistory: true`、`historyMessages: 6`、`historyChars: 2000`、
  `length: 'normal'` 等默认值；`saveSettings` 同样回传生效值。面板因此总是预填，复选框默认勾选。
- 实测（端口 56886）：`{"op":"settings"}` 返回
  `{"ok":true,"settings":{"strategy":"llm","style":"natural","length":"normal","language":"auto","includeHistory":true,"historyMessages":6,"historyChars":2000,…},"overrides":{…}}`；
  `client.js` 内含「模型改写（花 token）」「自动识别」「分节模板」三个中文标签。
- 单测 85/85：新增桥断言（`settings` 默认开上下文、6 轮；`saveSettings` 回传生效值）与客户端断言
  （选项中文标签、复选框默认勾选、数字框预填 6）。

---

## 7.11 v1.4.1：在真实 DSH 里验证 `github:` 安装

目标：证明他人可以用 `github:mowei1600/dsh-enhanced-prompt` 这种格式装进 DSH 并真正被加载，
而不只是在临时目录里跑通 pnpm。

环境：DSH NEXT Desktop `2.0.21-next`、Harness `0.2.1-rc.4`、profile `desktop`（正在运行）。

做法（等价于插件管理器的 `install_bundle`：DSH 会用 `git ls-remote` 校验后用 pnpm 安装；
当前会话没有暴露 `plugin_manager` 工具，所以直接在 profile 里执行同一步）：

```powershell
cd $env:USERPROFILE\.dsh\profiles\desktop
$env:HTTPS_PROXY='http://127.0.0.1:7890'
pnpm add github:mowei1600/dsh-enhanced-prompt
```

结果：

```text
[WARN] Replaced "dsh-enhanced-prompt" ("link:../../plugins/dsh-enhanced-prompt")
       with "github:mowei1600/dsh-enhanced-prompt" from a different source.
+ dsh-enhanced-prompt 1.4.1
Done in 19.6s using pnpm v12.18.0
```

`package.json` 的依赖变为 `"dsh-enhanced-prompt": "github:mowei1600/dsh-enhanced-prompt"`，
`dsh.profile.bundles` 里本来就有该 bundle（安装器写入过），无需改动。

**如何证明加载的不是旧链接目录**：给 `node_modules/dsh-enhanced-prompt/index.js` 打上
`VERSION = '9.9.9-installed'` 哨兵，再重启 DSH（绕过插件管理器时，运行期解析表不会被重新发布，
只有重启才会从 `package.json` 重新解析）。Host 日志出现：

```text
[enhanced-prompt] activated v9.9.9-installed strategy=llm style=natural/normal route=magpie/…(default) …
```

即 Host 确实加载了 **pnpm 从 GitHub 装出来的那份**，而不是 `$DSH_HOME/plugins/…` 的本地链接。
随后把哨兵还原为发布内容（与仓库 `index.js` 逐字节一致），通过一次 patch 变更触发重组，
日志回到 `activated v1.4.1`，桥接口 `ping` 返回 `{"version":"1.4.1"}`。

功能冒烟（同一份 GitHub 安装副本）：

```text
POST /enhance/api {"op":"enhance","text":"帮我写个周报"}
-> ok=true chars=214 ms=2354 provider=magpie   （返回可直接发送的中文提示词）
POST /enhance/api {"op":"settings"}
-> {"includeHistory":true,"historyMessages":6,"historyChars":2000,…}
```

同时验证了插件管理器会读取的清单字段：`dsh.bundle.patch` 指向存在的 `cordis.patch.yml`、
`exports["./client"]` 存在、`engines.dsh = ">=0.2.1-rc.4"`（v1.4.1 新增，用于兼容性判断）。
DSH 的简写解析正则是 `/^(?:github|gitlab|bitbucket|gist):/i`，`github:mowei1600/dsh-enhanced-prompt`
与其 `#v1.4.1` 形式都能命中。

结论：**该仓库可以通过 `github:mowei1600/dsh-enhanced-prompt` 在 DSH 中安装并正常加载**；
用插件管理器的正式路径安装时无需重启（管理器会发布运行期解析并触发 HMR 重组），
手工 `pnpm add` 等价操作则需要重启一次。

---

## 7.10 v1.4.0：开源仓库化与「从 GitHub 安装」

目标：把插件变成一个可被他人从 GitHub 直接安装的开源项目。

- **仓库根 = 可安装 bundle**：`package.json` 提到仓库根（`dsh.bundle.patch: ./cordis.patch.yml`、
  `dsh.client.platform: web`、`exports["./client"]`），`bin/`、`lib/`、`client/`、`test/`、`docs/`
  全部围绕根目录组织。这样 pnpm 的 git 安装与 DSH 的
  `plugin_manager({ action: "install_bundle", target: "github:<owner>/<repo>" })` 都能直接工作
  （DSH 会先 `git ls-remote` 校验仓库，再走 pnpm）。
- **一行安装器**：`scripts/install.ps1` / `scripts/install.sh` 克隆仓库到临时目录后调用
  `bin/install.mjs install --profile <profile>`，支持 `DSH_PROFILE`、`DSH_REPO`、`DSH_REF` 覆盖。
- **社区文件**：`LICENSE` (MIT)、`README.md` + `README.zh-CN.md`、`CHANGELOG.md`、`CONTRIBUTING.md`、
  `CODE_OF_CONDUCT.md`、`SECURITY.md`、`.gitignore`、`.gitattributes`、`.editorconfig`、
  `.github/workflows/ci.yml`（Node 20/22：文本卫生 + bundle 新鲜度 + 单测 + 语法检查）、
  issue 表单与 PR 模板。
- **文本卫生脚本**`scripts/check-text.mjs`：CI 与本地 `npm run check:text` 共用，拒绝 BOM / CRLF / 替换字符。

验证：

```text
cd dsh-enhanced-prompt
node scripts/check-text.mjs       # text hygiene ok (46 files)
node scripts/build-client.mjs     # wrote client.js (23063 bytes, v1.4.0)
node --test                       # 85/85 pass
node bin/install.mjs install --profile desktop
  -> plugin link replaced: $DSH_HOME/plugins/dsh-enhanced-prompt -> <repo>
  -> profile link unchanged, bundle selected, patch block present
```

`bin/install.mjs status --json` 显示依赖为 `link:<repo 的绝对路径>`、bundle 已选、patch 块存在；
由于 Host 进程是上一版本启动的，新版本 Host 代码需要重启 DSH 才生效（客户端 bundle 仍按刷新页面加载）。

踩坑记录（第三次同类事故）：把仓库里的 `index.js` 用 PowerShell 5.1
`Get-Content -Raw | Set-Content -Encoding UTF8` 改版本号，中文被按 GBK 读取后二次编码，文件立即损坏
（`node --check` 报 `Invalid or unexpected token`）。恢复方式：用 Node 从完好的工作副本复制并做字符串替换，
复核 BOM / `U+FFFD` / CRLF / CJK 数量与 `node --check`。**结论不变：仓库内所有文本改动只用 Node 或编辑器。**

---

## 9. 未覆盖项与限制

| 项 | 状态 |
| --- | --- |
| GUI 中 `/enhance` 的实际渲染与执行 | 未由自动化验证（会话是 agent 进程，没有命令执行面，也没有浏览器控制）。命令已在 `ctx.commands` 注册成功（日志）；建议人工在输入框执行 `/enhance 帮我写个周报` 确认样式 |
| 输入框按钮的实际渲染与点击 | bundle 已生成、槽位注册与交互逻辑由 `test/client.test.mjs` 覆盖；**浏览器内视觉与点击未自动验证**（无浏览器控制）。首次需刷新页面，必要时重启 DSH |
| `/enhance apply` 的会话内行为 | 单测覆盖（UserMessage 形状、agent.steer 调用、失败降级）+ 类型契约比对；线上需人工触发一次 |
| 多轮 / 跨会话状态 | 插件无状态；按钮状态在组件内按会话隔离，不存在跨会话泄漏路径 |
| 冷启动（非 HMR）加载 | 未实测重启；但重启走同一条 bundle → patch → row 加载路径，HMR 已验证该路径的每一环；客户端清单也只在启动时扫描 |
| 最小 profile（无 `workingDirectory` / `commands` / `systemPrompt` / `slots`） | 代码按 `ctx.inject` 能力存在性降级；无 cwd 注入；单测覆盖无服务工作目录场景；无 `slots` 时浏览器半边不激活 |

---

## 10. 复现步骤（干净环境）

```bash
# 1) 单测（含浏览器 bundle）
cd workbuddy-prompt/plugin
node scripts/build-client.mjs
node --test

# 2) 安装并确认
node bin/install.mjs install --profile desktop
node bin/install.mjs status  --profile desktop --json

# 3) 观察 Host 日志（等待数秒）
#    路径：$DSH_HOME/logs/desktop-next.log
#    期望：4 行 [enhanced-prompt] registered/activated
#    其它部署按启动器日志路径调整

# 4) GUI 中验证（首次请先刷新页面）
#    输入框输入任意文字 → 下方出现「增强」→ 点击 → 草稿原地变成结构化提示词
#    → 「恢复原文」写回原文
/enhance 帮我写个周报
/enhance apply 帮我写个周报
```

判据：日志出现 4 行注册/激活；按钮在空草稿时不显示、有文字时出现并原地替换草稿；命令返回结构化
提示词且含「原输入 … 字 · 具体度 X → Y · v…」；`apply` 后会话出现一条以增强结果为用户消息的新请求。
