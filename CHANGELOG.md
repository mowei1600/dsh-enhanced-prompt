# Changelog

All notable changes to this project are documented here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.4.1] — 2026-11-20

### Added

- `engines.dsh: ">=0.2.1-rc.4"` so the DSH plugin manager can evaluate compatibility explicitly
  instead of relying on the "no requirement declared" fallback.
- Install docs show the pinned form `github:mowei1600/dsh-enhanced-prompt#v1.4.1` next to the
  floating `main` form.

### Verified

- `pnpm add github:mowei1600/dsh-enhanced-prompt` installs the bundle with `client.js`,
  `cordis.patch.yml`, `lib/`, `locale/` and `icon.svg`, and the manifest passes the bundle/engines
  checks the plugin manager performs.

## [1.4.0] — 2026-11-20

### Added

- Open-source packaging: repository root is the installable bundle, so
  `plugin_manager({ action: "install_bundle", target: "github:mowei1600/dsh-enhanced-prompt" })`
  works directly.
- One-line installers `scripts/install.ps1` / `scripts/install.sh` (clone + local install).
- CI workflow, text-hygiene check, issue/PR templates, contribution and security docs.

### Changed

- `package.json` now carries repository/homepage/license metadata and dev scripts
  (`check:client`, `check:text`, `check`, `install:dsh`).

## [1.3.1] — 2026-11-20

### Changed

- Settings panel options use localized labels (Chinese/English) while stored values stay canonical.
- The `settings` bridge op returns **effective values** (defaults included) plus `overrides`, so the
  panel opens pre-filled; conversation context defaults to on with 6 turns / 2000 characters.

## [1.3.0] — 2026-11-20

### Added

- Conversation context for every rewrite: the Host reads the session's recent turns through
  `ctx.sessions` and reports `meta.historyChars`; togglable from the panel or `history.enabled`.
- In-plugin settings: `lib/settings.js` (atomic write, key whitelist, re-validated on read),
  ⚙ panel in the composer row, `settings` / `saveSettings` bridge ops, `/enhance settings` and
  `/enhance set key=value`.
- `style` (natural/structured), `length` (short/normal/detailed) and `extraInstruction` options.

## [1.2.1] — 2026-11-18

### Changed

- Rewrite output is now the prompt text itself: no section headings, no placeholders, no quoted
  original, capped at ~200–300 Chinese characters / ~150 English words.

## [1.2.0] — 2026-11-18

### Added

- Model-backed rewriting through `ctx.llm` (default `strategy: 'llm'`), with route resolution from
  config or the profile's default model.
- Private same-origin bridge `POST /enhance/api` for the composer button; busy and error states;
  distinct error codes for missing route, timeout, provider failure and empty output.
- `lib/llm.js`, `lib/bridge.js`; the composer bundle no longer inlines the offline engine.

## [1.1.x] — 2026-11-18

### Added

- Composer button in the `conversation.input.right` slot, immediately left of the model selector
  (28×28 icon button), with in-place draft replacement and a restore affordance.

## [1.0.x] — 2026-11-18

### Added

- Initial bundle: `/enhance` command, `enhance_prompt` tool, optional guidance prompt section,
  deterministic offline engine with five templates, installer/uninstaller and tests.

[1.4.0]: https://github.com/mowei1600/dsh-enhanced-prompt/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/mowei1600/dsh-enhanced-prompt/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/mowei1600/dsh-enhanced-prompt/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/mowei1600/dsh-enhanced-prompt/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/mowei1600/dsh-enhanced-prompt/compare/v1.1.1...v1.2.0
