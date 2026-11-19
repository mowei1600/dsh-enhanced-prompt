# Publishing this repository

> **Status: published.** `main` and the annotated tag `v1.4.0` are on
> <https://github.com/mowei1600/dsh-enhanced-prompt>, the CI workflow is green on both pushed
> commits, and the release is live:
> <https://github.com/mowei1600/dsh-enhanced-prompt/releases/tag/v1.4.0>. A fresh clone from
> GitHub was verified to pass all 85 tests and to produce a valid install plan, so the `github:`
> install path is live. Remaining one-time steps are the repository settings in section 2.

The repository is complete locally (single commit, tag `v1.4.0`, `origin` configured). This guide
keeps the push/settings/verification steps for future releases and forks.

## 1. Push

```powershell
cd <path>\dsh-enhanced-prompt
git remote -v                     # origin -> https://github.com/mowei1600/dsh-enhanced-prompt.git
git push -u origin main
git push origin v1.4.0
```

If `git push` fails with `Failed to connect to github.com:443 over proxy 127.0.0.1`, your global
git config points at a local proxy that is not running:

```powershell
git config --get http.https://github.com.proxy    # http://127.0.0.1:7890
# start your proxy, or bypass it for this one push:
git -c "http.https://github.com.proxy=" push -u origin main
```

Authentication uses Git Credential Manager (`credential.helper=manager`). Sign in with a GitHub
account that owns `mowei1600/dsh-enhanced-prompt`, or use a personal access token:

```powershell
git -c "http.https://github.com.proxy=..." push https://<token>@github.com/mowei1600/dsh-enhanced-prompt.git main
```

## 2. Repository settings worth enabling

- **About**: description + topics `dsh`, `dsh-plugin`, `deepseek-harness`, `prompt-engineering`,
  `llm`.
- **Releases**: publish `v1.4.0` from the existing tag; the changelog section is already written.
- **Security**: enable private vulnerability reporting (matches `SECURITY.md`).
- **Actions**: the CI workflow runs on push and pull requests; no secrets are needed.
- **Pages** (optional): not required.

## 3. Verify the install path others will use

On a machine that can reach GitHub, in a DSH session with the plugin manager (Creator preset,
`danger-full-access`):

```jsonc
{ "action": "install_bundle", "target": "github:mowei1600/dsh-enhanced-prompt" }
```

Then check:

```text
/enhance status                    # version + model route
```

and the Host log for `[enhanced-prompt] activated v1.4.0 …`.

Alternative check without DSH:

```bash
git clone https://github.com/mowei1600/dsh-enhanced-prompt.git
cd dsh-enhanced-prompt
npm test && node bin/install.mjs status --profile desktop
```

## 4. Release checklist for the next version

1. Bump `version` in `package.json` and `VERSION` in `index.js` (keep them equal).
2. `node scripts/build-client.mjs` (the bundle stamps the version).
3. Add a `CHANGELOG.md` section and, if behaviour changed, `docs/design.md` / `docs/verification.md`.
4. `npm run check` (text hygiene + bundle freshness + tests).
5. `git commit -am "release: vX.Y.Z" && git tag -a vX.Y.Z -m "vX.Y.Z" && git push --follow-tags`.
