/**
 * Plugin-private HTTP bridge for the browser half.
 *
 * The composer button cannot reach `ctx.llm` (that service lives in the Host),
 * so the Host exposes exactly one same-origin endpoint:
 *
 *   POST <path>   { op: 'enhance', text, sessionId?, preset?, language?, tone? }
 *                 { op: 'ping' }
 *
 * Security posture (the route owner owns all of it — `dsh-host-webserver` ships
 * no auth or origin policy):
 *   - POST only; JSON content type only; body capped at BRIDGE_MAX_BODY;
 *   - Origin, when present, must match the Host header (same-origin fetch);
 *   - one in-flight rewrite per session, so a stuck call cannot pile up;
 *   - no filesystem access, no session-log writes, no draft reads: the request
 *     carries the text, the response carries only the rewritten prompt.
 *
 * @module dsh-enhanced-prompt/lib/bridge
 */

/** Hard cap on one request body. A draft is text; anything larger is abuse. */
export const BRIDGE_MAX_BODY = 65536

/** Default endpoint path. */
export const BRIDGE_PATH = '/enhance/api'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

/** Map a rewrite error code to an HTTP status. */
function statusForCode(code) {
  switch (code) {
    case 'no-route': return 400
    case 'llm-unavailable': return 503
    case 'timeout': return 504
    case 'cancelled': return 408
    case 'provider-error': return 502
    case 'empty-output': return 422
    case 'busy': return 429
    case 'bad-request': return 400
    default: return 500
  }
}

/** Write one JSON response unless the socket is already gone. */
function sendJson(res, status, payload) {
  try {
    if (res.headersSent || res.writableEnded) return
    res.writeHead(status, JSON_HEADERS)
    res.end(JSON.stringify(payload))
  } catch {
    try { res.destroy() } catch { /* already closed */ }
  }
}

/** Same-origin guard: an Origin header, when sent, must name this Host. */
export function isSameOrigin(headers) {
  const origin = headers?.origin
  if (typeof origin !== 'string' || origin.length === 0) return true
  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  const host = headers?.host
  return typeof host === 'string' && host.length > 0 && originHost === host
}

/** Read the body with a hard byte cap. Resolves `undefined` when the cap is hit. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      if (done) return
      size += chunk.length
      if (size > limit) {
        finish(undefined)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    req.on('error', (error) => {
      if (done) return
      done = true
      reject(error)
    })
  })
}

/**
 * Build the request handler.
 *
 * @param {{
 *   version: string,
 *   strategy: string,
 *   describeRoute: () => { provider?: string, model?: string, source?: string } | undefined,
 *   enhance: (request: { text: string, sessionId?: string, preset?: string, language?: string, tone?: string, signal?: AbortSignal }) => Promise<{ enhanced: string, provider?: string, model?: string, routeSource?: string }>,
 *   getConfig?: () => { strategy?: string, maxInputCharacters?: number } | undefined,
 *   getSettings?: () => Record<string, unknown>,
 *   saveSettings?: (next: Record<string, unknown>) => Record<string, unknown>,
 *   maxInputCharacters?: number,
 *   maxInFlight?: number,
 * }} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createBridgeHandler(deps) {
  const inFlight = new Map()
  const maxInFlight = Number.isFinite(deps.maxInFlight) && deps.maxInFlight > 0 ? deps.maxInFlight : 2
  const maxInputCharacters = Number.isFinite(deps.maxInputCharacters) ? deps.maxInputCharacters : 8000

  return async function handle(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'POST only' } })
      return
    }
    if (!isSameOrigin(req.headers)) {
      sendJson(res, 403, { ok: false, error: { code: 'cross-origin', message: 'same-origin requests only' } })
      return
    }
    const contentType = String(req.headers['content-type'] ?? '')
    if (!contentType.toLowerCase().includes('application/json')) {
      sendJson(res, 415, { ok: false, error: { code: 'unsupported-media-type', message: 'application/json required' } })
      return
    }

    let body
    try {
      body = await readBody(req, BRIDGE_MAX_BODY)
    } catch {
      sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'could not read the request body' } })
      return
    }
    if (body === undefined) {
      sendJson(res, 413, { ok: false, error: { code: 'payload-too-large', message: `body exceeds ${BRIDGE_MAX_BODY} bytes` } })
      return
    }
    let payload
    try {
      payload = JSON.parse(body)
    } catch {
      sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'body is not valid JSON' } })
      return
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'body must be a JSON object' } })
      return
    }

    const op = payload.op
    if (op === 'ping') {
      const route = deps.describeRoute()
      const live = deps.getConfig?.()
      sendJson(res, 200, {
        ok: true,
        version: deps.version,
        strategy: live?.strategy ?? deps.strategy,
        route: route ?? null,
      })
      return
    }
    if (op === 'settings') {
      // Effective values (defaults included) so the panel opens pre-filled;
      // `overrides` is kept for clients that want to show what the user changed.
      sendJson(res, 200, {
        ok: true,
        settings: deps.describeSettings?.() ?? deps.getSettings?.() ?? {},
        overrides: deps.getSettings?.() ?? {},
      })
      return
    }
    if (op === 'resetSettings') {
      if (typeof deps.resetSettings !== 'function') {
        sendJson(res, 503, { ok: false, error: { code: 'settings-unavailable', message: 'settings are not writable in this build' } })
        return
      }
      try {
        deps.resetSettings()
        sendJson(res, 200, {
          ok: true,
          settings: deps.describeSettings?.() ?? {},
          overrides: {},
        })
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: { code: 'settings-write-failed', message: String((error && error.message) || 'could not reset settings') },
        })
      }
      return
    }
    if (op === 'saveSettings') {
      const next = payload.settings
      if (next === null || typeof next !== 'object' || Array.isArray(next)) {
        sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'settings must be a JSON object' } })
        return
      }
      if (typeof deps.saveSettings !== 'function') {
        sendJson(res, 503, { ok: false, error: { code: 'settings-unavailable', message: 'settings are not writable in this build' } })
        return
      }
      try {
        deps.saveSettings(next)
        sendJson(res, 200, {
          ok: true,
          settings: deps.describeSettings?.() ?? next,
          overrides: deps.getSettings?.() ?? next,
        })
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: { code: 'settings-write-failed', message: String((error && error.message) || 'could not save settings') },
        })
      }
      return
    }
    if (op !== 'enhance') {
      sendJson(res, 404, { ok: false, error: { code: 'unknown-op', message: `unknown op ${JSON.stringify(op)}` } })
      return
    }

    const liveConfig = deps.getConfig?.()
    const inputLimit = Number.isFinite(liveConfig?.maxInputCharacters) ? liveConfig.maxInputCharacters : maxInputCharacters
    const text = typeof payload.text === 'string' ? payload.text : ''
    if (text.trim().length === 0) {
      sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'text is required' } })
      return
    }
    if (text.length > inputLimit) {
      sendJson(res, 413, {
        ok: false,
        error: { code: 'input-too-long', message: `text exceeds ${inputLimit} characters` },
      })
      return
    }
    const sessionKey = typeof payload.sessionId === 'string' && payload.sessionId.length > 0
      ? payload.sessionId
      : 'anonymous'
    if (inFlight.has(sessionKey)) {
      sendJson(res, 429, { ok: false, error: { code: 'busy', message: 'a rewrite is already running for this session' } })
      return
    }

    const controller = new AbortController()
    const abortOnClose = () => controller.abort()
    req.on('close', abortOnClose)
    inFlight.set(sessionKey, true)
    const startedAt = Date.now()
    try {
      const result = await deps.enhance({
        text,
        sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : undefined,
        preset: typeof payload.preset === 'string' ? payload.preset : undefined,
        language: typeof payload.language === 'string' ? payload.language : undefined,
        tone: typeof payload.tone === 'string' ? payload.tone : undefined,
        signal: controller.signal,
      })
      sendJson(res, 200, {
        ok: true,
        enhanced: result.enhanced,
        meta: {
          provider: result.provider ?? null,
          model: result.model ?? null,
          routeSource: result.routeSource ?? null,
          historyChars: result.historyChars ?? null,
          elapsedMs: Date.now() - startedAt,
          chars: result.enhanced.length,
        },
      })
    } catch (error) {
      const code = String((error && error.code) || 'provider-error')
      sendJson(res, statusForCode(code), {
        ok: false,
        error: {
          code,
          message: String((error && error.message) || 'rewrite failed'),
          elapsedMs: Date.now() - startedAt,
        },
      })
    } finally {
      req.removeListener('close', abortOnClose)
      inFlight.delete(sessionKey)
      if (inFlight.size > maxInFlight) inFlight.clear()
    }
  }
}

/**
 * Register the bridge on the Host web server.
 *
 * @param {object} ctx - a context that owns `webServer`.
 * @param {{ path: string, handler: (req: object, res: object) => Promise<void> | void }} options
 * @returns {() => void} disposer
 */
export function registerBridge(ctx, options) {
  return ctx.webServer.register({
    kind: 'exact',
    path: options.path,
    handler: options.handler,
  })
}
