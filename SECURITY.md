# Security policy

## Supported versions

The `main` branch and the latest release receive fixes. Older releases are supported on a
best-effort basis.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's private vulnerability
reporting (Security → Report a vulnerability) or contact the maintainer listed in `package.json`.
Include:

- affected version (`/enhance status`),
- how to reproduce (steps, expected vs actual),
- the relevant Host log lines beginning with `[enhanced-prompt]`,
- your assessment of impact.

You can expect an initial response within a few days.

## What the plugin touches

- **Host side**: registers a slash command, a tool, an optional system-prompt section, and one
  same-origin route (`POST /enhance/api`). It reads the session's recent turns through
  `ctx.sessions`, calls the model through `ctx.llm`, and writes one settings file under
  `$DSH_HOME/enhanced-prompt.settings.json`.
- **Browser side**: a memoised component in the composer row. It reads the draft through the
  session standard kit (`useInput`), writes through `inputActions.setDraft`, and only talks to the
  same-origin endpoint.

The plugin does not spawn processes other than the model call, does not read arbitrary files, does
not open network connections of its own, and does not send telemetry.

## Hardening already present

- POST-only, JSON-only, same-origin-checked bridge with a body cap and one in-flight rewrite per
  session.
- Settings keys are whitelisted and re-validated through `normalizeConfig()` on every read.
- The installers snapshot the profile files they touch and write atomically.
