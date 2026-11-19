# Contributing

Thanks for taking the time to improve this plugin.

## Ground rules

- Be kind: this project follows the [Code of Conduct](./CODE_OF_CONDUCT.md).
- Keep the plugin honest about what it does: it performs a real model call (tokens) and writes the
  result back into the draft. Do not add silent fallbacks that change the output shape.
- No third-party prompt text, assets, logos or branding. Everything in the repository is
  self-authored.
- The Host code must stay dependency-free (Node built-ins only) and the browser bundle may only
  `require('react')`.

## Development setup

```bash
git clone https://github.com/<you>/dsh-enhanced-prompt.git
cd dsh-enhanced-prompt
npm test                 # unit tests (no DSH required)
npm run check:text       # encoding hygiene
npm run check:client     # generated bundle is in sync
```

Edit `client/ui.js` for UI changes, then:

```bash
npm run build:client     # regenerate client.js (commit the result)
```

To try the plugin in a real harness:

```bash
node bin/install.mjs install --profile desktop
# refresh the DSH window afterwards; watch the Host log for [enhanced-prompt] lines
```

## What a good PR contains

- A focused change with tests (`test/*.test.mjs`).
- `npm run check` green (bundle freshness, text hygiene, unit tests).
- A CHANGELOG entry under "Unreleased".
- If it changes behaviour, a line in `docs/design.md` or `docs/verification.md`.

## Commit style

Conventional prefixes are welcome but not enforced: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.

## Reporting bugs

Open an issue with the template; include the DSH version (`/enhance status` prints the plugin
version and model route), your Node version, the Host log lines starting with `[enhanced-prompt]`,
and whether the composer button or the command path is affected.
