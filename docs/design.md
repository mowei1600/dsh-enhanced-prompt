# DSH 增强提示词插件 · 设计与实现

- 版本：v1.4.0
- 仓库布局：**仓库根目录就是可安装的 bundle 包**（`package.json` 在根，`dsh.bundle.patch` 指向根下的
  `cordis.patch.yml`），因此 DSH 可以直接用 `github:<owner>/<repo>` 安装；`docs/` 放设计与验证记录。
- 目标宿主：DeepSeek Harness `0.2.1-rc.4`（DSH NEXT Desktop 2.0.21-next，profile `desktop`）
- 对照产品：腾讯 WorkBuddy 客户端「增强提示词」功能（调研见 [research-workbuddy.md](./research-workbuddy.md)）
- 交付物：可直接安装到 DSH profile 的 Host-only bundle `dsh-enhanced-prompt`

---

## 1. 结论摘要

| 问题 | 结论 |
| --- | --- |
| 复刻了什么 | 「把一句话的模糊需求展开成结构化、可直接发送的提示词」这一能力，含输入处理、改写策略、交互流程、结果输出四段 |
| 怎么落在 DSH | 一个 bundle（Host 半边 + 浏览器半边）：Host 注册三类原生扩展点——`/enhance` 斜杠命令、`enhance_prompt` 工具、可选系统提示段；浏览器半边在 `conversation.input.right` 槽位注册输入框控件行里的「增强」按钮（模型选择器左侧） |
| 改写是否用模型 | v1.2 起**默认用模型**：Host 通过 `ctx.llm` 调一次模型（花 token），路由取自配置或 profile 默认模型；离线确定性引擎（`lib/engine.js`）保留为 `strategy: 'rule'` 与独立 CLI |
| 与原产品最大差异 | 原产品「按钮 → 原地回填 + 恢复原文」已按同形态复刻；差异在**状态语义**：`setDraft` 不是可撤销的历史步，因此「恢复原文」由插件自己保存并写回，且一旦用户编辑了增强结果就不再显示（见 §12） |
| 合规 | 提示词与模板 100% 自研；不逆向、不抓取、不使用其 Logo/图标/素材；包名 `dsh-enhanced-prompt` 为中性命名（见 §13） |
| 验证状态 | 单测 85/85 通过（引擎 32 + Host 20 + 浏览器 9 + LLM/桥 13 + 设置/历史 11）；已安装进 `desktop` profile 并由运行中的 Host 通过 HMR 激活到 v1.3.1；真模型改写、会话上下文（`historyChars=2063`）、⚙ 面板（中文选项 + 默认值预填 + 保存生效）均经 `POST /enhance/api` 实测；GUI 视觉需刷新页面人工确认（见 [verification.md](./verification.md)） |

---

## 2. 需求基线（提炼自调研）

调研的关键事实（每条在 [research-workbuddy.md](./research-workbuddy.md) 有来源编号）：

- **R1 入口**：输入框旁的小按钮，输入框为空时不显示；大量用户因此找不到入口。
- **R2 状态**：增强结果必须绑定「当前会话 / 当前草稿」；官方曾修复「增强提示词跨会话泄漏」（5.1.0）与「回流误判」（5.3.7）。
- **R3 交互**：单击后结果**原地回填输入框**（官方用词「回流」），可继续编辑，提供「恢复原文」；不是模态预览。
- **R4 改写目标**：多源一致的四个要素——**角色 / 背景 / 任务拆解 / 输出格式**；单候选；LLM 改写属推断。
- **R5 输出**：**输出即提示词正文**——自然语言、可直接发送，不分节、不列提纲、不引用原文、不写占位符；
  回填到输入框的就是那一段（命令/工具面板额外加一行元信息，草稿本身不加）。
- **R6 「六段式」定位**：目标/输入/动作/约束/输出/验收是伙伴站面向**人写提示词**的写法，**不是**增强器的输出 schema。
- **R7 授权红线**：EULA 9.2 禁止逆向取提示词(1)、自动化抓取(2)、镜像/复制服务(3)、改动商标(4)、补丁改写运行指令(8)；用户输入输出权利归用户(12.4)。

---

## 3. 插件结构

```
workbuddy-prompt/
├─ README.md                      # 总交付说明（安装/配置/验证/差异）
├─ docs/
│  ├─ research-workbuddy.md       # WorkBuddy 功能调研（含来源与证据分级）
│  ├─ design.md                   # 本文
│  ├─ verification.md             # 安装与验证记录（实测）
│  └─ review.md                   # 独立规范审查报告
├─ rollback/                      # 安装前 profile 基线（人工回滚）
└─ plugin/                        # ← 可安装的 bundle 根目录
   ├─ package.json                # name=dsh-enhanced-prompt, dsh.bundle.patch, exports(locale/icon)
   ├─ cordis.patch.yml            # bundle patch：插入 enhanced-prompt 行 + 默认配置
   ├─ index.js                    # Host 插件：配置规范化、命令、工具、提示段、HTTP 桥
   ├─ lib/
   │  ├─ llm.js                   # 模型改写：路由解析、提示词、流式收集、超时与错误码
   │  ├─ bridge.js                # POST /enhance/api：同源/限长/单会话单并发
   │  ├─ engine.js                # 离线引擎 enhance(raw, config) 编排 + 结果/错误约定
   │  ├─ analysis.js              # 输入规范化、语言识别、意图分类、具体度评分
   │  ├─ presets.js               # 5 套模板注册与 auto 选择
   │  ├─ preset-copy.js           # 中英文分节文案 + 确定性填充器
   │  └─ README-engine.md         # 引擎 API 与保证
   ├─ locale/{en,zh}.json         # meta.title / meta.description（插件管理器显示）
   ├─ icon.svg                    # 自绘图标（原创造型）
   ├─ client.js                   # 浏览器 bundle（构建产物；`__ModuleLoader__.load` 形态）
   ├─ client/ui.js                # 按钮组件源码模板（构建时注入版本号）
   ├─ scripts/build-client.mjs    # 生成 client.js；`--check` 校验与源码一致
   ├─ bin/install.mjs             # install / uninstall / status 本地安装器（原子写 + 备份）
   ├─ bin/enhance.mjs             # 独立 CLI：不依赖 DSH，直接调用离线引擎
   ├─ test/engine.test.mjs        # 引擎单测（24 例）
   ├─ test/engine-presets.test.mjs# 模板单测（8 例）
   ├─ test/host.test.mjs          # Host 装配单测（20 例，mock ctx）
   ├─ test/client.test.mjs        # 浏览器 bundle 单测（8 例，fake window/React/fetch）
   └─ test/llm.test.mjs           # 模型路径与桥单测（12 例，fake ctx.llm + req/res）
```

关键约定：

- 包内所有运行期文件都是 ESM、零第三方依赖；浏览器 bundle 由 `scripts/build-client.mjs` 生成（`--check` 防漂移）。
- `plugin/` 目录本身就是安装单元；`dsh.bundle.patch` 指向包内 patch。
- 改写默认在 Host 侧完成：命令/工具直接调 `ctx.llm`，按钮经 `POST /enhance/api` 间接调用；浏览器不持有 provider 凭据。

---

## 4. 运行架构与 DSH 扩展点

```
profile/
  dsh.profile.bundles += dsh-enhanced-prompt
  node_modules/dsh-enhanced-prompt -> ~/.dsh/plugins/dsh-enhanced-prompt
        │  bundle patch: insert row { id: enhanced-prompt, name: dsh-enhanced-prompt, config: {...} }
        ▼
  Host plugin apply(ctx, config)
        ├─ ctx.inject(['commands'])     → /enhance 命令         （人类入口·键盘）
        ├─ ctx.inject(['tools'])        → enhance_prompt 工具   （模型入口）
        └─ ctx.inject(['systemPrompt']) → enhanced-prompt:guidance 段（何时该用工具）
                 │
                 ▼
        lib/engine.js  enhance()  纯函数：输入 → 结构化提示词 + meta

  Browser half（client.js，由 scripts/build-client.mjs 生成）
        └─ ctx.slots.register({ name: 'conversation.input.right', id: 'enhanced-prompt' }, 按钮组件)
                 ├─ 读草稿：useInput((s) => s.draft)        （InputBar 的会话级 selector hook）
                 ├─ 写草稿：inputActions.setDraft(text)     （宿主提交路径同源的公开 action）
                 └─ 改写：内联的同一份 engine.enhance()
```

为什么选这三个扩展点（对照 `references/practices.md` 的「由弱到强」原则）：

| 扩展点 | 作用 | 为什么不是更强的机制 |
| --- | --- | --- |
| `ctx.commands.register` | 用户显式触发、结果不进模型历史 | 不监听 `agent/pre-step`、不改写用户消息：会话日志是唯一事实来源，改写历史会让日志与模型所见不一致 |
| `ctx.tools.register` | 让 agent 自己把模糊需求重述清楚后再执行 | 不做 `tools/pre-execute` 改写：该环节明确不支持改写参数，且会破坏日志一致性 |
| `ctx.systemPrompt.section` | 静态引导，阈值化 | 不使用 `system-prompt/assemble` 整体替换：那会接管其它插件的贡献 |

工具注册使用**原始 JSON Schema 定义**而不是宿主提供的 `defineTool()` 辅助函数：`defineTool` 来自
`@deepseek-ai/dsh-tools`，引用它会破坏「零依赖、可直接链接」的约束；两者在运行期的产物等价——
`defineTool` 只是把参数 DSL 编译成同一份 JSON Schema 并加一层参数校验。注册表本身仍会按
`parameters` 校验模型传入的参数，`execute()` 里也对可选参数做了白名单与范围校验。

生命周期：三类注册都通过 `ctx.inject(...)` 的子 scope 建立，插件卸载 / profile 重载时由 Cordis
自动回收；插件不写任何会话事件，不修改 inbox，不持有跨会话状态（天然满足 R2）。

---

## 5. 输入处理

入口有两处，输入处理一致：

| 入口 | 输入来源 | 处理 |
| --- | --- | --- |
| `/enhance <文本>` | 命令 `rawInput`（命令名之后的原始文本，含空格） | 语法解析 → 文本 |
| `enhance_prompt` 工具 | `prompt` 参数（模型传入，要求原样传递用户措辞） | 直接作为文本 |
| `/enhance apply <文本>` | 同上 | 增强成功后经 `agent.steer()` 提交 |

引擎侧 `normalizeInput()`：

- 去掉零宽字符、统一换行、压缩 3 个以上连续空行为 1 个空行；
- 按 **UTF-8 字节**上限截断（默认 8000 B），只在**码点边界**切，不劈坏多字节字符；
- 记录原始字符数、字节数、是否截断（截断会成为 `input-truncated` 警告）；
- 空输入 → `empty-input` 错误，命令返回用法提示，**不改变任何东西**；
- 超过硬上限（262144 B）→ `too-long` 错误。

**保守边界**：只增强文本本身。附件、`@` 引用、历史对话不参与改写（调研里这些是【未知】项），避免
把上下文语义错误吸收进提示词。

**上下文事实（只取可信来源）**：`context.include*` 打开时，插件向引擎提供三类事实——会话工作
目录、工作区名、参考日期。工作目录通过 Host 的 `workingDirectory` 服务读取
（`ctx.get('workingDirectory', false).get(agent.session)`），而不是 `process.cwd()`：Desktop Host
的进程 cwd 是 profile 目录（`~/.dsh/profiles/<name>`），把它写进提示词既无用又泄漏宿主路径。服务
不可用时**不注入任何 cwd**（没有进程 cwd 回退），任何含 `.dsh` / `.agents` 的内部路径也会被过滤，
不进入模型可见文本。

语言：按 CJK 字符占比识别 `zh` / `en` / `mixed`；渲染语言由 `language` 配置决定（`auto` 时跟随
识别结果）。命令面板的中文/英文外壳同样按输入语言切换。

---

## 6. 提示词改写策略

### 6.1 模板（presets）

| preset | 分节 | 适用 |
| --- | --- | --- |
| `standard`（auto 默认） | 角色 / 背景 / 任务拆解 / 输出格式 / 约束 / 验收标准 | 通用模糊需求；对应调研 R4 的四要素并补齐约束与验收 |
| `six-section` | 目标 / 输入 / 动作 / 约束 / 输出 / 验收 | 需要「目标—验收」闭环的任务；**来源是公开的人写提示词指南，不是原产品输出格式** |
| `goal-oriented` | 目标 / 背景 / 交付物 / 约束 / 成功标准 | 有明确交付物的任务 |
| `concise` | 目标 / 动作 / 输出（三行） | 快速改写一句话 |
| `code` | 角色 / 任务 / 约束 / 验收（工程口吻） | 代码类需求 |

`preset: auto` 的选择规则：意图分类置信度 ≥ 0.6 时按意图选（code→`code`，writing/planning/data→
`goal-oriented`），否则回落 `standard`。`meta.preset` 永远返回具体模板 id，`meta.presetSource`
记录 `explicit|auto`。

### 6.2 填什么、不填什么

- 有依据才填：分节内容只从用户原文与调用方提供的上下文（cwd / workspace 名 / 日期）推导。
- 没依据就留空位：统一占位符 `（待补充）` / `(to fill in)`，并产生 `facts-marked-unknown` 警告。
  **绝不编造事实、数据、引用、链接**。
- 原意保真：`includeOriginal: true` 时，`enhanced` 内嵌原始请求块，`meta.originalPreserved` 记录
  是否生效 —— 这是相对原产品的显式质量契约（原产品只有「恢复原文」按钮，没有保真承诺）。
- 单候选：与原产品一致，不做多方案选择器，降低决策成本。
- 确定性：同一输入 + 同一配置 → 逐字节相同输出；不读时钟、不联网、不随机。`meta.elapsedMs` 由
  Host 测量后写入。

### 6.3 具体度评分

`scoreSpecificity()` 对文本的六个维度打分：目标、上下文、约束、输出格式、验收、时间范围，输出
0–100 分与缺失维度列表。用途：

- 命令预览显示「具体度 14 → 100」，让用户看到补全效果；
- 系统提示段用阈值（默认 45）判断一条用户消息是否「模糊到值得先增强」。

### 6.4 语言与意图

意图分类使用中英双语关键词表（writing / code / data / research / planning / ops），命中数与
竞争项差值折算为 0–1 置信度；`writing` 的中文词表覆盖 写/周报/报告/总结/复盘/汇报/纪要/提纲 等。
语言检测按 CJK 占比给出 `zh` / `en` / `mixed`，渲染时 `mixed` 跟随 CJK 占比。

---

## 7. 交互流程

### 7.0 人类：输入框控件行里的「增强」按钮（浏览器半边）

- **槽位**：`conversation.input.right`（list，session scope）——它渲染在 `standardControls` 里、模型选择器
  **之前**（`children: [renderSlot('conversation.input.right'), renderSlot('conversation.input.model')]`），
  所以按钮正好落在输入框底部控件行、模型选择器左侧，与截图位置一致。注册 id 必须唯一（否则槽位注册抛错），`order: 5`。
- **样式**：与宿主自带控件同规格——28×28 圆形、`border-radius: 999px`、图标 16px、行内 gap 12px；
  颜色用 `--dsw-alias-label-secondary`，悬停 `--dsw-alias-interactive-bg-hover`，不写死颜色。
  图标复用宿主图标集的 sparkle 造型（16×16、`currentColor` 描边），请求进行中换成同一个圆形里的旋转环。
- **改写链路**：点击 → `POST /enhance/api {op:'enhance', text, sessionId}` → Host 内 `ctx.llm` 调一次模型
  → 回填 `inputActions.setDraft(enhanced)`。按钮不持有 provider 凭据，也不内联任何引擎代码。
- **输出形态（v1.2.1 起）**：回填的是**一段可直接发送的提示词正文**——自然语言、以用户第一人称对 AI 说话，
  不分节、不列提纲、不引用原文、不写「（待补充）」占位符；缺信息就让提示词里要求 AI 先问，而不是留空。
  模型指令同时限长（中文约 200–300 字 / 英文约 150 词），避免把输入框塞满。
- **显隐**：草稿为空时组件返回 `null`（与原产品一致）；有文字后出现「增强」。
- **读草稿**：`useInput((s) => s.draft)`——InputBar 的会话级 selector hook，订阅已发布的 InputState（`{draft, attachmentIds, draftRev, phase, …}`），只在文本实际变化时重渲染。
- **写草稿**：`inputActions.setDraft(text)` 整体替换；该 action 自发布、自持久化，**不需要**额外 `persistDraft()`。
- **恢复原文**：`setDraft` 在编辑器里是 history-merge 写入，**不是可撤销的历史步**，也没有 restore API，所以由组件保存「增强前原文」与「本次写入的文本」两个状态：仅当当前草稿仍等于本次写入的文本时显示「恢复原文」；写回后自动清除。用户一旦手动编辑增强结果，恢复按钮消失，避免覆盖编辑。
- **会话隔离**：槽位本身是 session scope，组件状态天然按会话存在；另外监听 `sessionId` 变化做一次防御性重置。
- **性能**：入口用 `React.memo` 包裹——InputBar 每次击键都会重渲染，按钮不能跟着重渲染。
- **模型调用**：按钮只发一个同源请求；改写、超时（默认 45 s）、错误分类都在 Host 的 `lib/llm.js` 完成。
  流式只消费 `text-delta` 块，`finish.kind = error|aborted` 映射为稳定错误码；输出会剥掉模型多加的
  ``` 围栏与前缀，但不会改写正文。
- **失败**：请求失败时按钮旁显示「增强失败」（悬停看具体原因），**不修改草稿**；成功前按钮禁用并显示旋转环。
- **⚙ 设置面板（v1.3.0 起，v1.3.1 完善）**：同一个槽位里再注册一个 28×28 齿轮按钮；点开是一个 `position: fixed` 的
  小面板（尺寸取自齿轮自身的 `getBoundingClientRect()`，Esc 关闭），字段包括改写方式、输出风格、长度、
  语言、会话上下文（开关 + 轮数 + 字数）、provider/model、超时、额外要求。读写都走 `POST /enhance/api`
  的 `settings` / `saveSettings`，落盘到 `$DSH_HOME/enhanced-prompt.settings.json`（原子写、键白名单），
  保存后下一次改写即生效。面板是插件自己的 UI，不依赖宿主的 settings 表单服务。
  v1.3.1 起：**选项一律使用中文标签**（值仍是 `llm`/`natural`/`short` 等规范值），打开面板时服务端返回
  **生效值**（`settings` op 同时给 `settings` 与 `overrides`），所以开关和数字框都带默认值预填
  （会话上下文默认开、6 轮 / 2000 字），不会出现空白项。
- **会话上下文（v1.3.0 起）**：按钮请求带上 `sessionId`；Host 用 `ctx.sessions.get(id).deriveMessages()`
  取最近几轮纯文本，按 `history.messages` / `history.chars` 裁剪后作为上下文块发给模型，并在响应 meta
  里回传 `historyChars` 便于观测。**这是「按当前会话上下文优化」的实现点**：同一句「再短一点」，有上下文时
  会被改写成「压缩上一条回复」的具体提示词。
- **生效方式**：客户端模块图在启动时扫描 `dsh.client` 清单，所以首次加入按钮后需要**刷新页面**；若仍未出现则重启 DSH。

### 7.1 人类：`/enhance`

```
/enhance <粗提示词>                 → 预览：结构化提示词 + 具体度对比 + 应用提示
/enhance apply <粗提示词>           → 先增强，再以普通用户消息提交（agent.steer）
/enhance preset <id> <粗提示词>     → 指定模板预览
/enhance lang <zh|en|auto> <文本>   → 指定输出语言
/enhance status                     → 当前配置与版本
/enhance help                       → 用法
```

- 预览结果由命令面板渲染，**不进入模型历史**（`ctx.commands` 的语义），所以反复预览零 token 成本。
- `apply` 提交的是一条完整的 `UserMessage`：
  `{ id: randomUUID(), role: 'user', content: [{type:'text',text}], source: { kind: 'enhanced-prompt' } }`。
  这是安装版契约要求的形状——收件箱按 `message.id` 去重，第一方生产者都用 `createUserMessage()`
  （`id = brandString(randomUUID())`，而 `brandString` 运行时是恒等函数）。不带 `id` 的裸对象会让
  第二次 pending apply 抛 “already pending”，因此这里显式生成 UUID，同时保持零第三方依赖。
- 失败时只返回错误文本，**不提交任何消息**（满足 R5：失败原文一字不动）。
- 空输入 → 用法提示；未知模板名 → 列出可选值。

### 7.2 模型：`enhance_prompt` 工具

- 何时调用：用户明确要求「增强/展开/优化提示词」，或用户消息具体度低于阈值而任务需要多步执行。
- 参数：`prompt`（必填，原样用户措辞）、`preset`、`language`、`tone`、`maxBytes`（均可选）。
- `maxBytes`：取值 16–60000；输入字节数超过该值时**硬失败**并报出真实字节数；超出范围直接报错。
- 输出：canonical 值为 `{ ok, enhanced, preview, meta, error }`；模型看到的是渲染后的 Markdown
  预览。工具会**发起一次模型调用（花 token）**，但不写文件、不改会话；`timeoutMs` 取
  `llm.timeoutMs + 10 s`，让插件自己的超时先于注册表超时触发并给出明确错误。

### 7.3 模型：系统提示段

`enhanced-prompt:guidance`（order 5150，`interpolate: false`）说明：

- 什么时候该调用工具、什么时候不该（问候、确认、已经精确的请求不要调用）；
- 缺失信息要留占位符而不是猜；
- 人类可以自己用 `/enhance`。

该段是「软引导」，不限制任何工具能力。

---

## 8. 结果输出格式

### 8.1 引擎返回值（`lib/engine.js`）

```jsonc
{
  "ok": true,
  "original": "帮我写个周报",
  "enhanced": "> 原始请求：帮我写个周报\n\n## 角色\n…",
  "sections": [{ "key": "role", "title": "角色", "body": "…" }],
  "meta": {
    "preset": "goal-oriented",     // 永远不是 auto
    "presetSource": "auto",        // explicit | auto
    "language": "zh",
    "detectedLanguage": "zh",
    "intent": "writing",
    "intentConfidence": 0.65,
    "specificityBefore": 14,
    "specificityAfter": 100,
    "originalChars": 6,
    "enhancedChars": 449,
    "truncated": false,
    "strategy": "auto-intent",
    "originalPreserved": true,
    "elapsedMs": 0                 // Host 测量后回填
  },
  "warnings": ["facts-marked-unknown"]
}
```

失败：

```jsonc
{ "ok": false, "error": { "code": "empty-input", "message": "input is empty after normalization" } }
```

稳定警告码：`input-truncated`、`output-truncated`、`facts-marked-unknown`、`preset-fallback`。

### 8.2 命令与工具的 Markdown 预览

标题行（`# 增强提示词 · <preset> · <lang>`，h1）→ 改写结果正文 → 分隔线 → 一行元信息 → 警告行 → 尾注。

- **模型改写（默认）**：正文就是模型返回的提示词本身（自然语言，无分节）；元信息为
  `模型 <provider>/<model>（来源） · <ms> · v<version>`。
- **离线引擎（`strategy: rule`）**：正文是按模板渲染的分节文本（h2）；元信息为
  `原输入字数 · 具体度对比 · 意图 · 截断`。

命令尾注解释如何应用；工具尾注说明结果可直接执行。命令面板可直接复制。

### 8.3 工具输出：canonical 值 vs 模型可见内容

工具的 **canonical value**（定义里 `execute()` 的返回值，供 PTC/SDK 或程序化调用方读取）固定为
`{ ok:boolean, enhanced:string, preview:string, meta:string, error:string }`；其中 `meta` 是 JSON
字符串，避免依赖数组/嵌套 schema。

模型在 native 模式下看到的是 `output.render()` 的结果（一段 Markdown 预览），**不是**这个对象——
这是 DSH 的工具呈现契约（canonical 值属于执行侧，会话记录的是渲染内容）。两者语义一致：预览里
包含完整增强提示词、元信息行与警告行；失败时渲染为 `Error: <tool-facing message>`。工具失败文案
与命令失败文案分开：工具说「pass the raw request in the "prompt" field」，命令说「写在命令后面」，
避免在错误通道里出现对方语境的措辞。

---

## 9. 配置项

行 id 固定 `enhanced-prompt`；覆盖时在 profile 的 `cordis.patch.yml` 里按 id 覆写（patch 会**替换
整个 config**，需完整重述）。

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 关掉后 apply 直接返回，不注册任何能力 |
| `preset` | `auto` | `auto` / `standard` / `six-section` / `goal-oriented` / `concise` / `code` |
| `language` | `auto` | `auto` / `zh` / `en` |
| `tone` | `standard` | `concise` / `standard` / `detailed` |
| `maxInputBytes` | `8000` | 输入截断上限（码点边界） |
| `maxOutputBytes` | `16000` | 输出截断上限 |
| `includeOriginal` | `true` | 在增强结果内嵌原始请求块（保持可还原） |
| `allowApply` | `true` | 允许 `/enhance apply` 通过 `agent.steer()` 直接发送 |
| `command.enabled` | `true` | 是否注册斜杠命令 |
| `command.name` | `enhance` | 命令名（校验 `^[a-z0-9][a-z0-9_-]*$`，非法回退并告警） |
| `tool.enabled` | `true` | 是否注册工具 |
| `tool.name` | `enhance_prompt` | 工具名（校验 `^[A-Za-z0-9][A-Za-z0-9_.-]*$`） |
| `guidance.enabled` | `true` | 是否注册系统提示引导段 |
| `guidance.order` | `5150` | 段序（升序拼接） |
| `guidance.threshold` | `45` | 具体度低于该值时提示模型调用工具 |
| `context.includeCwd` | `true` | 把会话工作目录作为上下文输入 |
| `context.includeWorkspace` | `true` | 把工作目录末段作为 workspace 名 |
| `context.includeDate` | `true` | 把当天日期（`YYYY-MM-DD`）作为上下文输入 |
| `diagnostics` | `true` | 激活/各能力注册各打一行 Host 日志 |

非法值不会让插件崩溃：`normalizeConfigResult()` 回退到默认并返回 `warnings`，`apply()` 把
`configWarnings` 写进激活日志；不依赖模块级可变状态。

**为什么没有导出 `Config`（schemastery schema）**：导出 `Config` 会在激活时校验行配置，并让插件
管理器展示 schema；但 `@deepseek-ai/schemastery` 是宿主依赖，引用它会让这个 bundle 不再是零依赖、
可在任意 DSH 安装里直接链接的包。本插件改在 `normalizeConfigResult()` 里做同等的默认值 / 枚举 /
范围 / 名称语法校验，并在激活日志报告 `configWarnings`。若后续要接配置 UI，补一个 `Config`
导出即可（只改一个文件）。

---

## 10. 安装与加载

### 10.1 本地目录安装（本仓库方式）

```bash
node plugin/bin/install.mjs install --profile desktop
node plugin/bin/install.mjs status  --profile desktop --json
node plugin/bin/install.mjs uninstall --profile desktop
```

安装器做的事（与 `plugin_manager` `install_bundle` 的本地目录语义一致）：

1. `$DSH_HOME/plugins/dsh-enhanced-prompt` → 仓库 `plugin/` 目录（Windows junction，可用 `--copy` 改为复制）；
2. profile `node_modules/dsh-enhanced-prompt` → 上述目录（等价 `pnpm add link:...` 的结果）；
3. profile `package.json`：写入 `dependencies["dsh-enhanced-prompt"] = "link:../../plugins/dsh-enhanced-prompt"`，
   并把包名追加进 `dsh.profile.bundles`；
4. profile `cordis.patch.yml`：写入带标记的托管覆盖块（完整默认 config），同时触发 HMR 配置重载；
5. 写盘前把 profile 文件快照到 `$DSH_HOME/plugins/.backup-<name>-<timestamp>/`；
6. 两处写盘都使用**临时文件 + 原子 rename**，中断不会留下半写的 profile 文件。

### 10.2 有 `plugin_manager` 工具的预设

```
plugin_manager({ action: "install_bundle", target: "<本目录绝对路径>" })
```

> **安装路径的合规说明（对应独立审查 F3）**：DSH 插件开发规范要求用 `plugin_manager`
> `install_bundle` 完成 profile 安装，不要手写 profile 文件。本交付环境使用的预设没有暴露
> `plugin_manager` 工具（它只在 Creator 预设启用），因此 `bin/install.mjs` 以与 `install_bundle`
> **相同的语义**执行相同步骤，并额外做备份与原子写。**有 `plugin_manager` 时应优先用它**；本安装器
> 是等价回退路径，且 `uninstall` 可完整回滚。

### 10.3 加载过程

HMR 监听 profile 清单与 patch：`dsh.profile.bundles` 顺序变化会触发重组合，新 bundle 的行在重组
合时启动；插件激活后按能力打日志：

```
[enhanced-prompt] registered command /enhance
[enhanced-prompt] registered tool enhance_prompt
[enhanced-prompt] registered prompt section enhanced-prompt:guidance at order 5150
[enhanced-prompt] activated v1.0.5 preset=auto lang=auto caps=8000/16000B command=on tool=on guidance=on@5150<45
```

若数秒内未激活（无 HMR 或行未被重组合），重启 DSH 即可；重启走的是同一条加载路径。

---

## 11. 验证

分四层，详见 [verification.md](./verification.md)（含实际命令输出）：

```bash
# 1) 引擎单测（不需要 DSH）
cd plugin && node --test test/engine.test.mjs
cd plugin && node --test test/engine-presets.test.mjs

# 2) Host 装配单测（mock ctx，不需要 DSH）
cd plugin && node --test test/host.test.mjs

# 2b) 浏览器 bundle 单测（fake window + React，不需要 DSH）
cd plugin && node --test test/client.test.mjs
cd plugin && node scripts/build-client.mjs --check

# 3) 安装状态
node bin/install.mjs status --profile desktop --json

# 4) 线上验证
#    a. Host 日志出现 registered/activated 行
#    b. 新会话的工具列表里出现 enhance_prompt；调用它检查输出结构
#    c. GUI 里执行 /enhance 帮我写个周报 与 /enhance apply ...
```

当前结果：84/84 单测通过；`desktop` profile 已安装并由 HMR 激活到 v1.3.0；模型侧工具、系统提示引导段、
`maxBytes` 硬失败、错误文案、版本行经独立子会话实测；真模型改写经 `POST /enhance/api` 实测
（`magpie/ollama/deepseek-v4.1-flash:1017`，2989 ms，200 字，一段可直接发送的提示词正文）。
会话上下文实测：同一句「再短一点」在 live 会话上被改写成「压缩上一条回复…」的具体提示词，
`meta.historyChars=2063`；关闭上下文开关后同一请求 `historyChars=0`。设置面板实测：`saveSettings`
写入 `length=short` 后同一输入输出从 200 字降到 89 字。浏览器 bundle 的槽位注册、空草稿隐藏、忙碌态、
原地替换、恢复原文、编辑后收回恢复按钮、⚙ 面板读取与保存，都由 `test/client.test.mjs` 覆盖；路由解析、
提示词构造、流式收集、超时、桥的校验与并发限制由 `test/llm.test.mjs` 覆盖；设置文件白名单/原子写/合并映射、
上下文裁剪、`/enhance set` 语法由 `test/settings.test.mjs` 覆盖。GUI 里的实际渲染需刷新页面人工确认
（agent 会话没有浏览器控制）。

---

## 12. 相对 WorkBuddy 的必要适配

| 维度 | WorkBuddy 原功能 | 本插件 | 为什么必须改 |
| --- | --- | --- | --- |
| 入口 | 输入框旁按钮，有文字才显示 | **输入框控件行、模型选择器左侧的图标按钮**（有文字才出现）+ `/enhance` 命令 | 按钮已按原产品形态复刻；命令保留给键盘操作与无鼠标场景 |
| 结果落地 | **原地回填输入框**，可编辑 | **按钮：原地替换草稿**；命令：预览 + `/enhance apply` 直接发送 | 按钮走客户端 `inputActions.setDraft()`，与宿主自己的提交路径同源 |
| 撤销 | 「恢复原文」按钮 | **「恢复原文」按钮**（组件内保存原文并写回；编辑结果后自动收回）；增强结果内也内嵌原文 | `setDraft` 不是可撤销的历史步，也没有 restore API，兜底必须由插件提供 |
| 状态绑定 | 曾跨会话泄漏（已修） | 无状态：每次调用纯函数计算 | 从设计上消除该类缺陷 |
| 改写实现 | 推断为 LLM 改写 | **`ctx.llm` 模型改写（默认）**；`strategy:'rule'` 保留确定性引擎 | 与产品行为一致：花 token 换质量。确定性引擎保留给离线/零成本场景，但不作为默认，也不在模型失败时静默顶替 |
| 输出格式 | 自然语言指令，无 schema | 同样的自然语言指令 + 机器可读 `meta` | 增加可测试性与可观测性，不改变用户看到的东西 |
| 六段式 | 伙伴站的人写指南，非产品 schema | 作为可选模板之一，文档明确标注来源 | 避免把公开写作规范误当成原产品输出格式 |
| 计费 | 对话请求消耗积分；增强是否单独计费未知 | 零模型调用、零 token | 不引入无法解释的计费 |
| 语言 | 中英双语（海外版） | 自动识别 + 可强制 `zh/en` | 对齐可观察行为，并显式化 |
| 多候选 | 单候选 | 单候选 | 与原产品一致，降低决策成本 |

---

## 13. 合规与授权边界

| 事项 | 本插件的做法 |
| --- | --- |
| 专有提示词/模板文本 | 100% 自研；未使用任何 WorkBuddy 提示词、Skill、专家模板文本 |
| 逆向与抓取 | 未逆向客户端、未抓取其增强输出；调研只引用公开可访问的网页描述 |
| 商标与素材 | 包名 `dsh-enhanced-prompt`、命令/工具名为中性词；图标为自绘 SVG；产品名仅在文档中作对照性事实提及，不暗示关联或授权 |
| 运行指令改写 | 不修改任何其它插件/宿主代码，不注入系统提示覆盖，不 patch 运行中的指令 |
| 用户数据 | 引擎不联网、不落盘；上下文只取会话工作目录、workspace 名与日期，并过滤 Harness 内部路径；`/enhance apply` 提交的内容进入用户自己的会话日志 |
| 许可 | 插件代码 MIT；调研文档仅作设计依据 |

---

## 14. 限制与后续

- **模型路径的边界**：改写质量取决于所选模型与网络；超时、无路由、provider 报错都会以明确错误码
  返回（`no-route` / `timeout` / `provider-error` / `empty-output`），不会静默降级（除非显式打开
  `llm.fallbackToRule`）。没有 `ctx.llm` 的极简 profile 只能用 `strategy:'rule'`。
- **计费不可见**：插件不做 token 计数与成本提示，只回传 `elapsedMs`；成本以 Host/provider 侧为准。
- **桥是单机、同源、无鉴权**：与宿主 web 服务同一信任边界（`127.0.0.1`），仅 POST、限长、单会话单并发；
  若要暴露到局域网，需要额外的鉴权层——当前不做。
- **客户端形态的边界**：按钮挂在 `conversation.input.right`（输入框控件行、模型选择器左侧），
  不是悬浮在输入框内部的绝对定位元素；宿主没有提供更细的 composer 内部槽位，强行贴靠需要读宿主
  DOM，规范不允许。
- **首次加入按钮需刷新一次页面**：客户端模块图在启动时扫描 `dsh.client` 清单；之后的热重载由
  浏览器侧模块图负责，但清单变化本身不会触发 HMR（宿主限制）。
- **不支持附件/@引用参与改写**：调研中这些是未知项，v1 选择保守边界；`/enhance` 命令也未声明支持
  附件，附文件调用会被命令执行器拒绝并保留草稿。
- **具体度评分为启发式**：预览里的 `具体度 X → 100` 是规则评分，占位符未补齐时也可能偏高，属于
  展示性指标，不参与决策。
- **无增强历史 / 多步撤销**：与原产品一致（原产品也未见历史）；「恢复原文」只保留最近一次增强前的原文。
- **无快捷键**：可后续加 client 快捷键或命令之外的入口。
