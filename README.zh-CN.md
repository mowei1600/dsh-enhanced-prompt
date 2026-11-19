# 增强提示词 · DeepSeek Harness 插件

[English](./README.md) | 简体中文

[![CI](https://github.com/mowei1600/dsh-enhanced-prompt/actions/workflows/ci.yml/badge.svg)](https://github.com/mowei1600/dsh-enhanced-prompt/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mowei1600/dsh-enhanced-prompt?display_name=tag)](https://github.com/mowei1600/dsh-enhanced-prompt/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

把输入框里那句粗糙的话，用**你正在用的模型**、结合**当前会话上下文**，一键改写成**可以直接发送的提示词**。

- 模型选择器左侧的 ✦ 按钮：点一下，草稿原地变成改写后的提示词，并可用 ↩「恢复原文」撤回。
- `/enhance` 斜杠命令 + `enhance_prompt` 工具，给不方便点按钮的场景。
- ⚙ 设置面板：改写方式、输出风格/长度、语言、会话上下文、模型、超时、额外要求。
- 标准 DSH bundle：Host 半边 + Web 客户端，不改宿主文件、不埋点、不联网上报。

> 两个控件位于输入框底部控件行、模型选择器紧左边（截图请自行替换 `docs/assets/composer.png`）。

## 安装

要求：DeepSeek Harness `0.2.1-rc.4` 或更新版本、Node.js ≥ 18、Git。

### 方式 A：直接从 GitHub 安装（推荐）

在启用了插件管理器（Creator 预设、`danger-full-access`）的会话里：

```jsonc
// plugin_manager 工具
{ "action": "install_bundle", "target": "github:mowei1600/dsh-enhanced-prompt" }
```

DSH 会先用 `git ls-remote` 校验仓库，再通过 pnpm 安装并自动选中该 bundle。也可以直接填仓库 URL：
`https://github.com/mowei1600/dsh-enhanced-prompt`。

想固定版本（不跟随 `main`）就在后面加标签或提交号：

```jsonc
{ "action": "install_bundle", "target": "github:mowei1600/dsh-enhanced-prompt#v1.4.1" }
```

Fork 同样可用，把 owner/仓库名换掉即可。包内声明了 `engines.dsh: ">=0.2.1-rc.4"`，插件管理器会在
激活前做兼容性检查。

### 方式 B：一行命令安装器

PowerShell：

```powershell
irm https://raw.githubusercontent.com/mowei1600/dsh-enhanced-prompt/main/scripts/install.ps1 | iex
```

bash / zsh：

```bash
curl -fsSL https://raw.githubusercontent.com/mowei1600/dsh-enhanced-prompt/main/scripts/install.sh | sh
```

脚本会把仓库克隆到临时目录，再调用仓库内的安装器（默认 `--profile desktop`，可用
`-Profile <名字>` / `--profile <名字>` 指定其它 profile）。

### 方式 C：克隆后手动安装

```bash
git clone https://github.com/mowei1600/dsh-enhanced-prompt.git
cd dsh-enhanced-prompt
node bin/install.mjs install --profile desktop
node bin/install.mjs status  --profile desktop --json
```

安装器会把仓库链接到 `$DSH_HOME/plugins/dsh-enhanced-prompt` 与 profile 的 `node_modules`，
写依赖、选中 bundle，并在 profile 的 `cordis.patch.yml` 写入托管配置块（改动前会先快照 profile 文件）。

**安装后刷新页面**（`Ctrl+R` / `Cmd+R`）让输入框按钮加载；仍不生效则重启 DSH。

### 更新 / 卸载

```bash
git pull && node bin/install.mjs install --profile desktop   # 方式 B/C 更新
node bin/install.mjs uninstall --profile desktop             # 卸载
```

方式 A 请在插件管理器里用更新/移除操作。

## 使用

| 位置 | 作用 |
|---|---|
| 输入框控件行 | ✦ 原地改写草稿（一次模型调用，花 token）；↩ 恢复改写前的原文 |
| ⚙ 面板 | 改写方式、风格、长度、语言、会话上下文（轮数/字数）、模型、超时、额外要求 |
| `/enhance <需求>` | 在聊天里预览（`apply` 直接发送；`preset`/`lang` 调整离线引擎模板；`status`/`settings`/`set` 查看或修改设置） |
| `enhance_prompt` 工具 | 让 agent 在动手前把模糊请求重述成可执行规格 |

改写结果**就是提示词本身**：没有分节标题、没有「（待补充）」占位、不引用原文——就是你「如果写得足够清楚」会打出来的那段话。

## 配置

运行时设置存放在 `$DSH_HOME/enhanced-prompt.settings.json`，可用 ⚙ 面板或 `/enhance set key=value` 修改；
部署默认值在 bundle patch 里，可在 profile 的 `cordis.patch.yml` 覆盖：

```yaml
- id: enhanced-prompt
  config:
    enabled: true
    strategy: llm            # llm = 模型改写（花 token）| rule = 离线引擎
    style: natural           # natural = 提示词正文 | structured = 分节模板
    length: normal           # short | normal | detailed
    language: auto           # auto | zh | en
    extraInstruction: ''
    history: { enabled: true, messages: 6, chars: 2000 }
    llm:
      provider: ''           # 留空 = 跟随 profile 默认模型
      model: ''
      maxOutputTokens: 1400
      temperature: 0.2
      timeoutMs: 45000
      fallbackToRule: false
    bridge: { enabled: true, maxInFlight: 2 }
    diagnostics: true
```

`/enhance status` 会打印当前生效配置（含解析到的模型路由）。

## 安全与隐私

- 改写在 **Host** 内通过 `ctx.llm` 完成，浏览器拿不到任何 provider 凭据。
- 按钮只访问一个同源接口 `POST /enhance/api`：仅 POST + JSON、请求体限长、单会话单并发、Origin 校验。
- 草稿与会话上下文只用于本次改写请求；插件不写会话日志，除自己的设置文件外不落盘。
- 离线 `rule` 引擎不调用模型（气隙环境可用）。

## 开发

```bash
npm test                 # 85 个单测：引擎、Host 装配、客户端 bundle、LLM/桥、设置/历史
npm run check:client     # client.js 与 client/ui.js 是否一致
npm run check:text       # 文本文件无 BOM / CRLF / 替换字符
npm run build:client     # 修改 client/ui.js 后重新生成 client.js
```

目录结构见 [README.md](./README.md#development)，工作流见 [CONTRIBUTING.md](./CONTRIBUTING.md)，
架构说明见 [docs/design.md](./docs/design.md)。

## 许可

[MIT](./LICENSE)。本项目为独立实现：`docs/` 中作为对照对象提到的第三方产品，其提示词文本、素材与品牌
均未被使用。
