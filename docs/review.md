# Independent spec review — `dsh-enhanced-prompt` bundle

Reviewer: `plugin-reviewer` (independent of the author; read-only review; no install/uninstall/edit/restart, no pnpm).
Profile reviewed: `desktop` (`C:\Users\16001\.dsh\profiles\desktop`), live Host `desktop-next` of DSH NEXT Desktop 2.0.21-next / Harness `0.2.1-rc.4`.
Authoritative spec read (installed Harness): `cordis-plugin-development/{SKILL.md,references/{host-plugin.md,practices.md,verification.md,ui-plugin.md}}` and `cordis-composition-reference/SKILL.md` under `...\resources\app.asar.unpacked\node_modules\@deepseek-ai\dsh-agent-preset\skills\`.

## 1. Verdict

**pass-with-issues** — the delivered Host-only bundle is structurally compliant, all three capabilities are registered in the live Host, the live module generation now equals the static tree, and `node --test` is green (49/49). The one runtime defect found in the first pass (the `/enhance apply` message shape, F1) is **fixed and independently re-verified in v1.0.3**; the live/static generation mismatch (F2) is **resolved**. Remaining issues are process/compliance, not runtime blockers: the delivery installed through a hand-rolled profile installer that the spec says should be replaced by `plugin_manager install_bundle` (F3, spec violation of the delivery procedure), plus the "WorkBuddy" name in metadata/locale/README copy contradicting the package's own no-trademark claim (F4, risk), a remaining cwd-fallback exposure in minimal profiles (F5, risk), and nits.

### Review snapshot (final)

The tree changed three times while this review ran (v1.0.0 → v1.0.1 → v1.0.2 → v1.0.3); the helper CLI `bin/enhance.mjs` and its README section were added at 04:43Z. Findings and line numbers below refer to this final snapshot, verified live at `2026-11-18T04:42:35Z` (the 04:43 helper/README additions are not load-bearing for the live plugin). SHA-256, first 16 hex characters:

| File | mtime (UTC) | size | sha256[:16] |
|---|---|---|---|
| `plugin\index.js` | 2026-11-18T04:42:22Z | 27063 | `ab9465a798cbec3d` |
| `plugin\package.json` | 2026-11-18T04:42:25Z | 901 | `2049df71492d82a8` |
| `plugin\test\host.test.mjs` | 2026-11-18T04:42:22Z | 15737 | `8ea84a2d544ec4a7` |
| `plugin\cordis.patch.yml` | 2026-11-18T04:24:47Z | 1170 | `70dff653d3dc8928` |
| `plugin\README.md` | 2026-11-18T04:43:26Z | 4123 | `13e673e32ff38571` |
| `plugin\bin\install.mjs` / `bin\enhance.mjs` | 2026-11-18T04:28:13Z / 04:43:20Z | 11778 / 2786 | `8191726622a3228d` / `c0da9c9f1d86cfdc` |
| `plugin\locale\en.json` / `zh.json` | 2026-11-18T04:24:47Z | 309 / 329 | `90a8be3721e99475` / `d458ebae8fd93b96` |
| `plugin\icon.svg` | 2026-11-18T04:24:47Z | 767 | `555e33635b417aa6` |
| `plugin\lib\engine.js` / `analysis.js` / `presets.js` / `preset-copy.js` | 2026-11-18T04:27–04:31Z | — | `77f46dd8…` / `f3eace50…` / `44eb2389…` / `c7c2cf74…` |

## 2. Spec checklist

Legend: **PASS** = verified against the installed Harness; **PASS\*** = passes, with a nit in §3; **FAIL** = actionable defect. `index.js` line numbers are for `ab9465a798cbec3d`.

| # | Requirement (source) | Evidence | Status |
|---|---|---|---|
| 1 | Bundle manifest declares `dsh.bundle.patch` (host-plugin.md:3,11-18) | `package.json:24-28` → `./cordis.patch.yml`; file exists | PASS |
| 2 | `exports` for `./locale/*.json` and `./icon`, runtime export retained (host-plugin.md:35,44-49) | `package.json:9-14`; all four targets resolve on disk | PASS |
| 3 | `files` covers every runtime file (host-plugin.md:35) | `package.json:15-23`: `index.js`, `lib`, `bin`, `cordis.patch.yml`, `locale/*.json`, `icon.svg`, `README.md`; all present | PASS |
| 4 | `"type": "module"`, private, name/version sane | `package.json:2-5`; version `1.0.3` equals `VERSION` (`index.js:26`), `private: true`, MIT, `node >=18` | PASS |
| 5 | Patch is the Loader dialect: top-level array, `insert` rows with `id`/`name`/`config` (composition-ref:12-18; host-plugin.md:20-27) | `cordis.patch.yml:14-38`; one `- insert:` row, `id: enhanced-prompt`, `name: 'dsh-enhanced-prompt'`, full `config` | PASS |
| 6 | Inserted bare specifier resolves to the package name | `cordis.patch.yml:16` vs `package.json:2` | PASS |
| 7 | Row id matches the profile override target | bundle patch id `enhanced-prompt` (`cordis.patch.yml:15`) = profile override `- id: enhanced-prompt` (`C:\Users\16001\.dsh\profiles\desktop\cordis.patch.yml:264`, block 260-266) | PASS |
| 8 | No `!!js` misuse (composition-ref:22) | none in `cordis.patch.yml` or the package | PASS |
| 9 | Host export form: `apply(ctx, config)` + optional `name`/`inject`/`Config`, no form mixing (host-plugin.md:59-64) | named `apply` (`index.js:541`), `name` (`index.js:29`); also a default object (`index.js:609`) — see §3-F6 | PASS\* |
| 10 | Registrations inside `apply`, owned/disposed by the owning context (host-plugin.md:64; practices.md:8) | all three registrations are inside `ctx.inject([...])` callbacks (`index.js:565-599`); no module-level listeners or manual teardown | PASS |
| 11 | Optional services via `ctx.inject([...])` (practices.md:20) | `index.js:566,576,586`; live log shows all three activated | PASS |
| 12 | No new session event types, no session-history/composer rewrite (practices.md:21) | no `session.append`/`appendPluginRecord` anywhere in `plugin/`; `/enhance apply` only adds one steered user message (`index.js:496-511`) | PASS |
| 13 | Prompt section API: `ctx.systemPrompt.section({name, order, interpolate:false, text})` (practices.md:18; system-prompt README:55-68) | `index.js:588-593`; `text` may be a function (dsh-system-prompt `lib/index.js:389`); `interpolate:false` honoured | PASS |
| 14 | Unique section name; order does not collide with first-party orders | name `enhanced-prompt:guidance`; order `5150` (`index.js:590`) absent from `SECTION_ORDERS` (`dsh-system-prompt/lib/index.js:11-44`, incl. `TOOLS_SDK 5000`, `HARNESS_SOURCE 10000`, `WEB_SURFACE 10100`, `DEPLOYMENT_PERSONA_SUFFIX 10200`) | PASS |
| 15 | Tool parameters are raw JSON Schema within the supported subset (dsh-tools README:65; `json-schema.js` keyword sets) | `index.js:372-398` uses only `type`, `properties`, `required`, `additionalProperties`, `description`; all are in the enforced set (`dsh-tools/lib/types/json-schema.js:28-38`) | PASS |
| 16 | Output schema matches what `execute` returns | `index.js:399-416` declares `ok/enhanced/preview/meta/error` (`additionalProperties:false`); `execute` returns exactly those keys on both paths (`:437-445`); the value is validated by `ToolRuntime` (dsh-tools `lib/index.js:3637-3648`) | PASS |
| 17 | `render()` is replay-safe for undefined/old values | `index.js:411-415` coerces `value ?? {}` and does not throw for undefined; old-value fallback is weak → §3-F9 | PASS\* |
| 18 | `parameters`/`required`/`additionalProperties` consistent | `required:['prompt']` (`:397`); optional fields handled in `execute` (`:418-433`); extra keys rejected by the declared schema (but raw `register()` does not enforce args — F8) | PASS |
| 19 | Command definition: valid name grammar, `input.hint`, `{kind:'success'|'error',text}` results, guarded `agent.steer` (dsh-commands README:31-51) | name default `enhance` (`index.js:98`, regex `dsh-commands/lib/index.js:79,151`); `input.hint` (`:478`); every return is `kind`+`text` (`:479-514`); guard + try/catch around `steer` (`:499-509`) | PASS |
| 19b | Steered message conforms to the installed `UserMessage`/`MessageBase` contract | **fixed in v1.0.3**: `createUserMessage` helper (`index.js:450-466`) mints `{id, role:'user', content, source}`, steer uses it (`:503`); runtime check confirmed UUID ids/role/source and unique ids; test asserts the same (`test/host.test.mjs:140-166`) | PASS |
| 20 | `meta.title` + `meta.description` in both locales for the actual capability (host-plugin.md:31-34) | `locale/en.json:2-5`, `locale/zh.json:2-5`; both parse; titles/descriptions match the delivered capability | PASS |
| 21 | Valid icon in the package, within limits, original/licensed (host-plugin.md:36,51) | `icon.svg` 767 B (< 256 KiB), well-formed XML, `viewBox="0 0 64 64"`, original gradient/bubble artwork, no third-party mark | PASS |
| 22 | No leftover template copy (host-plugin.md:33) | grep for `My Decoration`/`@local/`/template boilerplate: none in `package.json`, locale, icon, README | PASS |
| 23 | Live install state: dependency, bundle selection, links, patch block | `node bin/install.mjs status --profile desktop --json` (exit 0): dependency `link:../../plugins/dsh-enhanced-prompt`, `bundleSelected: true` position 4, both links resolve to the workspace plugin, `patchBlock: present`; profile `package.json:11,22`, `cordis.patch.yml:260-266` | PASS |
| 24 | Live activation via HMR, log tail checked | `desktop-next.log`: 12 `[enhanced-prompt]` lines; latest generation `2026-11-18T04:42:35Z activated v1.0.3` + 3 registrations (earlier `04:32:09Z v1.0.0`, `04:36:33Z v1.0.1`); no plugin errors | PASS |
| 25 | Live code generation equals the static tree | static `v1.0.3` (`package.json:3`, `index.js:26`, mtime 04:42:22Z); live log `activated v1.0.3` at 04:42:35Z; last log write 04:42:35Z → live == static | PASS |
| 26 | Automated tests | `node --test` in `plugin/`: **49 tests, 49 pass, 0 fail, 0 cancelled, 0 skipped** (Node v26.13.0, exit 0); `node --test test/` same | PASS |
| 27 | No state shared across sessions (practices.md:7,26-27) | engine modules are pure (no clock/random/fs/network; only host `new Date()` for the date context); only module-level mutable is `configWarnings` (`index.js:58`) → §3-F7 | PASS\* |
| 28 | No proprietary WorkBuddy prompt text/assets/trademark in the package | engine copy is original (`lib/preset-copy.js`); generated prompts are vendor-free (`test/engine.test.mjs:208`, `test/engine-presets.test.mjs:99`); **but** the "WorkBuddy" name appears in `package.json:6`, `index.js:2`, `locale/en.json:7`, `locale/zh.json:7`, `README.md:3`, contrary to `README.md:108` → §3-F4 | FAIL |
| 29 | UI-plugin rules (`ui-plugin.md`) | not applicable: Host-only bundle, no `dsh.client`, no `client.js`; `package.json` has no client section | N/A |

## 3. Findings (ordered by severity)

### F1. `/enhance apply` steered a bare object instead of a `UserMessage` — [spec-violation] — **FIXED IN v1.0.3, RE-VERIFIED**

First-pass evidence (v1.0.2): `index.js` called `agent.steer({ content, source })` without `id`/`role`, while the installed API types the parameter as `steer(message: UserMessage): void` (`dsh-commands/lib/typert.host.js`, `Agent` declaration); `UserMessage extends MessageBase` and `MessageBase` requires `id: MessageId`, `content`, `source` (`dsh-llm/lib/typert.host.js`, `MessageBase`); first-party producers use `createUserMessage` (`dsh-plan-mode/lib/index.js:217`, `dsh-command-goal/lib/index.js:101`). Inbox dedupe keys on `message.id` (`dsh-agent-loop/lib/index.js:192-194`), so two pending applies would have collided.

v1.0.3 fix: `createUserMessage(text)` at `index.js:450-466` returns `{ id: randomUUID(), role: 'user', content: [{type:'text', text}], source: { kind:'enhanced-prompt' } }`; the apply branch calls `agent.steer(createUserMessage(result.enhanced))` (`index.js:503`). The reasoning is documented in the helper's JSDoc (`:450-458`); `brandString()` is identity at runtime (`dsh-brand/lib/index.js:20-22`), so a plain UUID is the complete runtime shape, and no `@deepseek-ai/dsh-llm` dependency is added (consistent with the zero-dependency bundle).

Re-verified: importing the v1.0.3 `index.js` and running `/enhance apply` twice produced messages with keys `id, role, content, source`, `role === 'user'`, UUID-shaped unique ids, and the enhanced text; `test/host.test.mjs:140-166` now asserts role, UUID shape, source kind and per-apply uniqueness. **No remaining action.** (Live `/enhance apply` in the GUI remains unexercised — see §5.)

### F2. Live Host ran `v1.0.1` while the static tree was `v1.0.2` — [risk] — **RESOLVED**

First pass: static `v1.0.2` vs live log `activated v1.0.1` (the log's last write was 04:36:57Z). The Lead reloaded after the v1.0.3 edit; the Host now logs `2026-11-18T04:42:35Z … activated v1.0.3` and `node bin/install.mjs status` reports `1.0.3`, matching `package.json:3` and `VERSION` (`index.js:26`). **No remaining action**; keep the reload step in the delivery checklist so a final edit never lands after the last reload.

### F3. Installation used a hand-rolled installer that writes profile state; the spec requires `install_bundle` — [spec-violation] (delivery procedure)

**Spec:** `cordis-plugin-development/SKILL.md:10`: *"Do not write the profile's `package.json` or `cordis.patch.yml`, create packages under `$DSH_HOME`, or run pnpm in the profile directory: `install_bundle` performs those steps, and each hand-made write outside the workspace needs its own approval."*

**Evidence:** `bin/install.mjs:186-216` writes the profile `package.json` and `cordis.patch.yml`; `:139-159` creates the junction under `$DSH_HOME/plugins`; `:117-126` writes backups under `$DSH_HOME/plugins/.backup-*`. Live evidence: two installer backups (`\.backup-dsh-enhanced-prompt-2026-11-18T04-32-07-595Z`, `…04-35-22-350Z`), the managed block at `cordis.patch.yml:260-266`, and the profile dependency at `package.json:22`. The managed block was also hand-edited across generations: the `# revision: …` line (`cordis.patch.yml:261`, now `v1.0.3 (identified UserMessage for agent.steer)`) is not produced by `install.mjs:197-205`; the v1.0.1 and v1.0.3 reloads were triggered by touching that block. During the edit window the Host observed two failed config reloads — `04:35:39Z` and `04:36:02Z`: `YAMLException: duplicated mapping key (248:3)` / `(247:3)` — before recovering at `04:36:33Z` (`verification.md:139-153` documents the same incident).

**Impact:** runtime state is valid and currently parses with exactly one managed block, but the procedure bypasses the sanctioned tool and the profile layer has already shown fragility (non-atomic rewrite + manual edit). This is the only remaining spec violation, and it is procedural, not a defect in the delivered JS.

**Minimal fix:** perform the install through `plugin_manager` `install_bundle` with the absolute bundle directory (it writes the same dependency/bundle/link/patch state), or explicitly record approval for `install.mjs` as the fallback. If `install.mjs` stays, make its patch write atomic (temp file + rename), refuse to write when a second managed block is present, and stop hand-editing inside the markers (put human notes outside them).

### F4. "WorkBuddy" trademark in package/locale/README copy contradicts the package's own compliance claim — [risk]

**Evidence:** `package.json:6` (`"WorkBuddy-style enhanced prompt …"`), `index.js:2` (`WorkBuddy-style "enhanced prompt"`), `locale/en.json:7` (`(WorkBuddy-style)`), `locale/zh.json:7` (`（WorkBuddy 风格）`), `README.md:3`, while `README.md:108` states: *"Independent implementation: no WorkBuddy prompt text, assets or trademarks are used."*

The important part is clean: the generated prompt copy is original (`lib/preset-copy.js`), the engine tests assert the output never contains the vendor name (`test/engine.test.mjs:208`, `test/engine-presets.test.mjs:99`), and the icon is original. The issue is metadata copy only.

**Impact:** checklist item 28 cannot pass; the README's claim is false as written. Nominative reference is low legal risk, but the delivery should not claim otherwise.

**Fix:** replace the vendor name in metadata/copy with neutral wording (e.g. "structured enhanced prompt"), including the unused locale `command` entries; if the user explicitly requested the comparison, keep a nominative reference but correct `README.md:108` and document why.

### F5. Working-directory fallback can still expose a non-session host path — [risk]

**Where:** `index.js:130-154` (path filter + fallback), `index.js:157-169` (`collectContext`).

The v1.0.1 fix (retained in v1.0.3) correctly prefers the Host `workingDirectory` service (`ctx.get('workingDirectory', false)` → `.get(agent.session)`, matching `dsh-working-directory/lib/index.js:24-25,76`), and this profile composes that service (`dsh-base/cordis.patch.yml:167-168`); the delivery's live record shows the session workspace, not the profile path (`verification.md:132`, author's record, not independently reproduced here). The residual risk is the fallback: when the service is absent (minimal profiles), `process.cwd()` is used and only paths containing `.dsh`/`.agents` are filtered; a Host launched from the app/installation directory would still put that path into user- and model-visible "Working directory"/"Workspace" fields.

**Minimal fix:** treat the service as required for cwd context (omit the field when absent), or default `context.includeCwd`/`includeWorkspace` to `false` in the bundle config; at minimum also filter the DSH installation directory.

### F6. Redundant dual export form — [nit]

`index.js:541` exports named `apply`, `index.js:609` exports `default { name, apply }`. The loader unwraps `exports.default ?? exports` first (`cordis-plugin-loader/lib/index.js:668-673`), so the runtime uses the default object and the named `apply`/`name` are dead at runtime; `host-plugin.md:59-64` says to export one form and not mix. Harmless but ambiguous. **Fix:** remove `export default` (keep the named form used by tests) or remove the named duplication.

### F7. Module-level mutable `configWarnings` — [nit]

`index.js:58` (`let configWarnings = []`), set at `:125`, read at `:605`. Shared process-wide; safe only because `apply()` is synchronous today. **Fix:** have `normalizeConfig` return `{ config, warnings }` and pass the warnings into `apply`'s local scope.

### F8. Raw `ctx.tools.register` bypasses `defineTool` argument validation — [nit]

`index.js:575-578` registers a raw definition. `ToolRuntime.register()` validates only `output.schema`; input arguments reach `execute` unvalidated (`dsh-tools/lib/index.js:2975-2984`), so `execute`'s defensive `typeof`/`Number.isFinite` checks silently ignore invalid `preset`/`language`/`tone`/`maxBytes` instead of returning an argument error (`index.js:418-433`). Behavior is safe; the model gets no schema-level `enum` guidance for the three enum-like fields. **Fix:** use `defineTool` (which compiles the object-root schema and validates args) or add `enum` + explicit arg validation; tests already assert the invalid-override fallback, so keep that behavior.

### F9. Tool `render` treats any non-`ok` value as an error — [nit]

`index.js:411-415`: `if (!v.ok) return [{ type:'text', text:\`Error: …\` }]`. `undefined` is handled, but a future/legacy stored value that lacks `ok` (e.g. after a schema change, during replay) would render a false error instead of the available `preview`/`enhanced` text. **Fix:** only treat `v.ok === false` as an error; otherwise fall back to `v.preview || v.enhanced || ''` (keeping undefined safe).

### F10. Configured command name is not grammar-validated — [nit]

`index.js:98` lowercases/trims `command.name` but does not enforce the command grammar `^[a-z][a-z0-9_-]*$` (`dsh-commands/lib/index.js:79,151`). A bad user config makes registration throw; the throw is caught and only logged when `diagnostics` is on (`index.js:570-572`), so `/enhance` silently disappears. **Fix:** validate/regex-fallback in `normalizeConfig`, and log registration failures at warning level independent of `diagnostics`.

### F11. Copy/i18n nits — [nit]

- Command failure copy is always Chinese (`index.js:481-486,497,507`) while help/status are bilingual; the tool error copy is English-only (`index.js:342-344`).
- `renderPreview` hardcodes ` · 输入已截断` in English previews (`index.js:330`), and picks its title table from the input language rather than `result.meta.language` (`index.js:319-323`).
- `context.date` uses UTC (`index.js:167`); users near midnight see a date that differs from their local calendar day while the label says "Reference date".
- `locale/*.json` `command` keys (`locale/en.json:6-8`, `locale/zh.json:6-8`) are never read — the command description/hint are hardcoded (`index.js:477-478`).
- `WARNING_LABELS` has an `'unknown-preset'` entry (`index.js:296-305`) but the engine only emits `'preset-fallback'` (`lib/presets.js:151`, `WARNING_CODES` in `lib/engine.js:83-88`).
- `bin/enhance.mjs:78` appends a no-op conditional (both branches are `''`), and the imported `PRESET_IDS` is otherwise unused — remove the conditional or use it to print a warning for an unknown `--preset`.

**Fix:** drive copy from the configured/rendered language consistently, use local date (or label UTC), and remove the dead locale/warning entries.

## 4. Reviewer answers to the two delivery questions

**Q1 — Is omitting `export const Config` acceptable, given `normalizeConfig()` validates instead?**

Yes, acceptable; not a spec violation. `host-plugin.md:59-64` lists `export const inject` and `export const Config` as **optional** members of the `apply` form, and the Config obligation is conditional: *"A plugin that declares `Config` validates the row's `config` at activation."* The bundle ships its own row config and `normalizeConfig()` (`index.js:84-127`) supplies defaults, clamps numerics, falls back on unknown enums, and records warnings, so the loader-level schema is not required for correct activation. Trade-offs to document, not defects: (a) `Config.listConfigs` will not expose a schema for this row, so tooling cannot discover the accepted fields (the bundle README documents them); (b) unknown top-level config keys are silently ignored. Optional hardening without adding a dependency: have `normalizeConfig()` warn on unknown top-level keys, as it already does for unknown `preset`/`language`/`tone`. No fix required.

**Q2 — Is there an ordering/masking risk with both the bundle patch and the profile override block?**

No ordering or masking bug in the current composition. Layers are applied in order — each bundle in `package.json`'s `dsh.profile.bundles`, then the profile `cordis.patch.yml` (`SKILL.md:8`, `cordis-composition-reference:12`) — so the bundle's `insert:` creates row `enhanced-prompt` first and the profile layer's id-targeted patch replaces that row's `config` wholesale (`host-plugin.md:3`, `cordis-composition-reference:15`; the row has no `name`, so nothing is asserted/renamed). The override restates every field (verified: its parsed JSON deep-equals the bundle patch config), so nothing is masked today. Remaining risks are maintenance, not correctness: the same defaults exist in four places — `cordis.patch.yml`, `index.js` `DEFAULT_CONFIG`, `install.mjs` `OVERRIDE_CONFIG`, and the profile block — so a future default change in only the bundle patch would be silently overridden by the stale profile block. Also, if the bundle were removed from `dsh.profile.bundles` while the managed block remained, the loader would warn `patch: entry "enhanced-prompt" not found` and skip it (harmless, but the installer should clean up). Recommendation: keep one source of truth (e.g. generate both the bundle patch config and installer `OVERRIDE_CONFIG` from `DEFAULT_CONFIG`, or add a test that compares them) and keep the installer's managed block authoritative as documented. No change strictly required for this delivery.

## 5. Verification commands run and results

All commands were read-only; no install/uninstall/edit/restart, no pnpm. Node: `C:\Program Files\nodejs\node.exe` v26.13.0. Working dir: `workbuddy-prompt\plugin` unless noted.

| Command | Result |
|---|---|
| `node --test` | `ℹ tests 49 / pass 49 / fail 0 / cancelled 0 / skipped 0 / duration_ms ≈ 187`, exit 0 |
| `node --test test/` | same 49/49/0, exit 0 (README's command also works) |
| `node --check index.js bin/install.mjs lib/{engine,analysis,presets,preset-copy}.js` | all exit 0 |
| `node --check bin/enhance.mjs`; `node bin/enhance.mjs "帮我写个周报"`; `node bin/enhance.mjs --help`; `echo … \| node bin/enhance.mjs --json` | all exit 0; the CLI prints the enhanced prompt (31 lines) and the metadata line, help prints the JSDoc header (20 lines), stdin `--json` prints 1705 chars of JSON; the README `bin/enhance.mjs` command works |
| `node bin/install.mjs status --profile desktop --json` | version `1.0.3`; dependency `link:../../plugins/dsh-enhanced-prompt`; `bundleSelected: true`, position 4; plugin link and profile link both resolve to `...\workbuddy-prompt\plugin`; `patchBlock: present`; exit 0 |
| Manifest script (Node) | `dsh.bundle.patch` exists; exports `.`/`./locale/*.json`/`./icon`/`./package.json` targets exist; every runtime file exists; `VERSION === package.json.version` (`1.0.3`); both locale JSONs parse with `meta.title`/`meta.description`; icon 767 B < 256 KiB |
| Profile/static comparison (Node) | static version `1.0.3`; profile dependency and bundle selection match; profile override block config is deep-equal to the bundle patch defaults; exactly one managed block; block revision comment `v1.0.3` |
| Icon XML check | `New-Object System.Xml.XmlDocument.LoadXml(...)` succeeds; root `svg`, `viewBox="0 0 64 64"`, 767 B |
| Log scan (`desktop-next.log`) | 12 `[enhanced-prompt]` lines total; `04:32:09Z activated v1.0.0` + 3 registrations; `04:36:33Z activated v1.0.1` + 3 registrations; `04:42:35Z activated v1.0.3` + 3 registrations; no plugin errors; the two profile-patch HMR parse failures at `04:35:39Z`/`04:36:02Z` (`duplicated mapping key`, see F3) recovered at `04:36:33Z` |
| Schema/keyword comparison | `index.js:372-398` uses only `type/properties/required/additionalProperties` + `description`, all within the enforced set (`dsh-tools/lib/types/json-schema.js:28-38`); same for `output.schema` |
| Steered-message shape (Node import of `index.js`, two applies) | each message: keys `id, role, content, source`; `role:'user'`; UUID-shaped unique ids; `content[0].type:'text'`; `source.kind:'enhanced-prompt'`; both handlers returned `success` |
| Runtime exercise of definitions (Node import of `index.js`) | command `/enhance 帮我写个周报` returns success with `### 增强提示词 · goal-oriented · zh` preview; tool `execute({prompt:'帮我写个周报'})` returns `ok:true` with the declared meta keys, deterministic across two calls (1240-byte enhanced prompt); tool render text matches the tool-footer variant; blank input returns `ok:false` with the tool-facing error and no exception |

Spec cross-checks read from the installed Harness (not from the delivery): `host-plugin.md`, `practices.md`, `verification.md`, `ui-plugin.md`, `cordis-composition-reference/SKILL.md`; plus installed package sources `dsh-system-prompt/lib/index.js`, `dsh-tools/lib/{index.js,types/json-schema.js}`, `dsh-commands/lib/index.js`, `dsh-agent/lib/index.js` + `dsh-agent/README.md`, `dsh-agent-loop/lib/index.js`, `dsh-working-directory/lib/index.js`, `cordis-plugin-loader/lib/index.js`.

## 6. Residual risks not fixable by this review environment

1. **Live `/enhance apply` in the GUI:** now contract-correct and unit-covered, but no GUI command was executed; the command surface is not reachable from this agent session and there is no browser control. One manual `/enhance apply …` in a chat would close this.
2. **GUI rendering of the command card, tool card, locale copy and icon:** no browser control; `verification.md:161` records the same limitation. Slot/tool rendering, dark/light appearance and the actual `/enhance` card are unverified visually.
3. **Cold start after restart:** the final v1.0.3 generation was validated through HMR only; a fresh restart should be re-confirmed (same bundle → patch → row path, but not exercised here).
4. **Profile-layer fragility (F3):** the managed block is hand-edited (revision comments) and HMR patch reloads already failed twice during the delivery window due to a duplicated YAML key; the current file parses with one block, but future hand edits or non-atomic installer writes can reproduce it.
5. **Minimal-profile behavior (F5):** without the `workingDirectory` service the fallback `process.cwd()` is only filtered for `.dsh`/`.agents`; not exercised in this profile.
6. **Version drift:** `package.json`, `index.js` `VERSION`, README, the profile managed-block revision comment and the live log are maintained by hand; they all read `1.0.3` now, but a delivery gate should compare them mechanically.
7. **`/enhance apply` inbox behavior under repeated applies:** the id collision is fixed and unit-tested for two applies; the real inbox/session-log path (identity-based queue actions, UI correlation) was not exercised live.
