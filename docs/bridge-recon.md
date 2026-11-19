# Plugin-private HTTP bridge (`ctx.webServer`) — recon

Scope: optional future **LLM-mode** work. Primary feature no longer needs it. Every claim cites installed code.
Paths: `WS` = `C:\Users\16001\Documents\deepseek-harness\default-workspace`; `APP` = `C:\Users\16001\AppData\Local\Programs\DSH NEXT\resources\app.asar.unpacked\..` (extracted copy at `WS\_asar\node_modules\@deepseek-ai\`).

## 1. Host API (verified, authoritative installed code)
- Service name is the string `"webServer"`: `super(ctx, "webServer")` — `_asar\node_modules\@deepseek-ai\dsh-host-webserver\lib\index.js:287`.
- Registration is **`ctx.webServer.register(route)`**, route = `{ kind: 'exact' | 'prefix', path, handler }`, returning a **disposer**; a duplicate `(kind, path)` throws — `dsh-host-webserver\lib\index.js:327-334`. README:62 states the same ("adds a named `exact` or `prefix` HTTP route ... returns a disposer").
- A second argument (a label string) is accepted by callers but **ignored** by `register`, which reads only `route` (`index.js:327-334`; purge passes one at `WS\purge-review\plugin\lib\index.js:1842-1848`).
- Handler signature is raw `node:http`: `await route.handler(req, res)` — `dsh-host-webserver\lib\index.js:384-386`. Pathname only (query stripped): `new URL(req.url ?? "/", "http://x").pathname` — `:382`. Exact table first, then longest prefix, then fallback — `:495-507`; prefix matches `pathname === prefix` or `pathname.startsWith(prefix + '/')` — `:501`. Unmatched + no fallback ⇒ 404 — `:388-393`.
- Handler throw ⇒ 400, or socket destroy when headers already sent; never kills the process — `:396-406`; README:72.
- Port / origin: `get port()` → listening port or `undefined` before bind — `:293-296`; `getOrigin()` → `http://127.0.0.1:<port>` — `:309-320`; `get protocol()` → `'http:' | 'https:'` — `:301-308`. Purge reads `String(ctx.webServer.port)` — `WS\purge-review\plugin\lib\redteam\ui.js:569`.
- **Guard (optional service)** — installed pattern: `ctx.inject(["webServer"], (webCtx) => { webCtx.effect(() => webCtx.webServer.register({ kind: "prefix", path: "/plugins", handler: this.serveBundle }), "label") })` — `_asar\node_modules\@deepseek-ai\dsh-client-modules\lib\index.js:563-570`. Hard-dependency variant: `export const inject = ['redteam', 'webServer']` — `WS\purge-review\plugin\lib\redteam\ui.js:155`. Registration tied to lifetime via `ctx.effect(...)` — `ui.js:1079`, `purge-review\plugin\lib\index.js:1834`.

## 2. Mounted in the `desktop` profile? YES
- Profile bundles = `dsh-base`, **`dsh-web-app`**, two experimental profiles, `dsh-enhanced-prompt` — `C:\Users\16001\.dsh\profiles\desktop\package.json:6-13`; tree is composed from bundle patches — `profiles\desktop\cordis.yml:1-4`.
- `dsh-web-app`'s patch inserts the `webserver` row (`@deepseek-ai/dsh-host-webserver`, `inject: [webStartup]`, host/port from `ctx.webStartup`) — `_asar\node_modules\@deepseek-ai\dsh-web-app\cordis.patch.yml:180-189`.
- Live: log line `dsh web: http://127.0.0.1:63158/?token=****` — `C:\Users\16001\.dsh\logs\desktop-next.log:243`; `GET /api` on that origin answers 401 from Connection's fence, unknown `GET` 404 / `POST` 405 — probed this session.

## 3. Auth / same-origin reality
- webServer itself has **no authentication or origin policy**; route owners enforce their own — `dsh-host-webserver\README.md:131`.
- Connection owns the fence for `/` and `/api` only: launch token → `authorizeIndex` writes an authority-bound signed cookie; cookie is `HttpOnly`, `Path=/`, `SameSite=Strict`, host-only; missing/expired ⇒ 401 **before** RPC dispatch — `_asar\node_modules\@deepseek-ai\dsh-client-connection\README.md:42,44`. Host must be loopback / bind IP; `Origin` must name the same authority; `sec-fetch-site: cross-site` refused ⇒ 403, unauthenticated ⇒ 401 — `:48`.
- A **custom route is NOT behind that fence**: `fetch('/enhance/api')` from the page does send the cookie (same-origin default), but the handler receives no verified identity. Origin/Host checking is therefore the route owner's job.
- Working owner-side check: method gate `ui.js:1083-1086`; loopback/same-origin gate `ui.js:1087-1114`; stricter `sec-fetch-site`/Origin/Host variant `purge-review\plugin\lib\index.js:1803-1828`.

## 4. Body in / JSON out
- Read body by hand (no framework): `req.on('data'/'end'/'error')`, cap then `req.destroy()` — `ui.js:590-611`; cap `MAX_BODY_BYTES = 8 * 1024 * 1024` — `ui.js:158`; alternative `for await (const chunk of request)` with 512 KiB default — `purge-review\plugin\lib\index.js:2655-2668`.
- Parse defensively: `raw.trim() ? JSON.parse(raw) : {}`, then per-op dispatch, catch ⇒ `sendJson(res, 400, { ok:false, error })` — `ui.js:1115-1153`.
- JSON out: `res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','content-length':Buffer.byteLength(body)}); res.end(body)` — `ui.js:613-622`.

## 5. Client side (browser half)
- Minimal call: `fetch('/redteam/api', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(req) }).then(r => r.json())` — `WS\purge-review\plugin\lib\redteam\client.js:567-571`.
- Production form adds `AbortController` timeout, `credentials:'same-origin'`, `cache:'no-store'`, non-JSON detection, and maps network failure to a user message — `purge-review\plugin\client.js:60-80`; missing route detected by `/\b404\b|\b405\b|non-json/i` — `client.js:110-112`.
- Browser half packaging: `dsh.client: { platform:'web' }` + `exports["./client"]` — validated at `_asar\node_modules\@deepseek-ai\dsh-client-modules\lib\index.js:62-76,172-182,732-746`; bundle must be `window.__ModuleLoader__.load({ id: '<package name>', factory: (require) => { … return module.exports } })` — `dsh-client-modules\lib\client.js:2`, `purge-review\plugin\client.js:1,8731-8736`. Exports face: `exports.name`, `exports.inject`, `exports.apply(ctx)`.

## 6. Design sketch for `POST /enhance/api` (not implemented)
- `kind:'exact'`, `path:'/enhance/api'`; `ctx.effect(() => ctx.webServer.register({...}))` so reload cannot duplicate-throw (`index.js:329`).
- Gate `req.method !== 'POST'` ⇒ 405 + `allow: 'POST'`; loopback/Origin check copied from `ui.js:1087-1114`.
- Body cap 64–256 KiB (text-only), reject over cap with 413; `JSON.parse` in try/catch ⇒ 400.
- Response `{ ok, enhanced, meta, warnings }`; pure CPU work from `lib/engine.js`; no fs, no session-log writes; per-request internal deadline; never echo secrets/config.
- Body `{ op:'enhance'|'undo', text, preset?, language? }`; validate `op` against a whitelist before touching the engine.

## 7. Caveat / blocking facts
- **Runtime probe:** `GET`/`POST http://127.0.0.1:63158/redteam/api` return 404/405 — identical to a control path (`/__dsh_probe_nonexistent__`). `dsh-purge` is **not** in the desktop bundle list (`profiles\desktop\package.json:6-13`) and never appears in the activation log, so the purge bridge is a **code-shape reference, not live proof** in this profile.
- NOT FOUND in the install: any docs for `dsh-client-connection`/`dsh-api-gateway`/`dsh-host-webserver` under `resources\app.asar.unpacked\node_modules\@deepseek-ai` (only `dsh-agent-preset`, `dsh-session-log-export`, `dsh-skill-badge`, `libreoffice-kit*`); the READMEs quoted above come from the Lead's extraction at `WS\_asar\`. Cordis `ctx.inject`/`ctx.effect` reference docs are also NOT FOUND — their signatures are inferred from the two call sites cited in §1.
