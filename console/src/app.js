// HTTP routing for the console. Business logic lives in recording.js (record control) and
// inputs-config.js (input registry); this file handles auth, CSRF, parsing and responses.

import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { authenticate } from './auth.js';
import { HttpError } from './recording.js';
import { InputConfigError, generatePassphrase } from './inputs-config.js';
import { parsePreviewPath, proxyPreview } from './preview.js';
import { createThrottle } from './throttle.js';

export { checkBasicAuth } from './auth.js';

const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const STATIC_FILES = new Set(['/index.html', '/app.js', '/preview-player.js', '/inputs-admin.js', '/style.css', '/vendor/hls.min.js']);
const MAX_BODY_BYTES = 4096;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  // blob: is required by hls.js (MediaSource object URLs and its transmux worker).
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:",
  'Cache-Control': 'no-store',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

const json = (res, status, payload) =>
  send(res, status, JSON.stringify(payload), { 'Content-Type': 'application/json' });
const ok = (res, data) => json(res, 200, { success: true, data, error: null });
const fail = (res, status, error) => json(res, status, { success: false, data: null, error });

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('not an object');
    return body;
  } catch {
    throw new HttpError(400, 'body must be a JSON object');
  }
}

// What an operator types into the camera / Creators' App for this input.
const cameraSettings = (input, host) => ({
  url: `srt://${host || '<server-ip>'}`,
  port: input.port,
  encryption: 'AES-128 (or AES-256)',
  passphrase: input.passphrase,
  latencyMs: input.latencyMs,
});

// Client address for throttling/audit. X-Forwarded-For is honoured (rightmost entry, i.e. the one
// our own reverse proxy appended) only when TRUST_PROXY is set; otherwise anyone could spoof it.
function clientIp(req, trustProxy) {
  if (trustProxy) {
    const last = String(req.headers['x-forwarded-for'] ?? '').split(',').pop().trim();
    if (last) return last;
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function createApp({ config, recording, inputs, state, listRecordings, publicDir, fetchImpl = fetch, log = console, throttle = createThrottle() }) {
  async function recordings(showAll) {
    const all = await listRecordings();
    const { clearedAt } = state.get();
    return showAll || !clearedAt ? all : all.filter((r) => r.modified > clearedAt);
  }

  function inputsConfigView() {
    return {
      publicHost: config.publicHost,
      portRange: [config.relayPortMin, config.relayPortMax],
      suggestedPort: inputs.suggestPort(),
      inputs: inputs.list().map((i) => ({ ...i, camera: cameraSettings(i, config.publicHost) })),
    };
  }

  async function guardNotRecording(name, what) {
    if (await recording.isRecording(name)) throw new HttpError(409, `stop recording on ${name} before ${what}`);
  }

  async function configRoutes(pathname, req) {
    if (pathname === '/api/config/inputs') {
      const body = await readJson(req);
      await inputs.add({ name: body.name, label: body.label, port: body.port || undefined, latencyMs: body.latencyMs, enabled: body.enabled });
      log.info(`[inputs] added ${body.name}`);
      return inputsConfigView();
    }
    const m = pathname.match(/^\/api\/config\/inputs\/([^/]+)(?:\/(delete|regenerate-passphrase))?$/);
    if (!m) throw new HttpError(404, 'not found');
    const name = decodeURIComponent(m[1]);
    if (!inputs.find(name)) throw new HttpError(404, `unknown input: ${name}`);

    if (m[2] === 'delete') {
      await guardNotRecording(name, 'removing it');
      await inputs.remove(name);
      log.info(`[inputs] removed ${name}`);
    } else if (m[2] === 'regenerate-passphrase') {
      await guardNotRecording(name, 'changing its passphrase');
      await inputs.update(name, { passphrase: generatePassphrase() });
      log.info(`[inputs] regenerated passphrase for ${name}`);
    } else {
      const body = await readJson(req);
      const current = inputs.find(name);
      const relayChange = ['port', 'latencyMs', 'enabled'].some((k) => body[k] !== undefined && body[k] !== current[k]);
      // Relay changes restart the listener, which would drop the camera and end the recording.
      if (relayChange) await guardNotRecording(name, 'changing port/latency/enabled');
      const changes = Object.fromEntries(['label', 'port', 'latencyMs', 'enabled'].filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
      await inputs.update(name, changes);
      log.info(`[inputs] updated ${name}: ${Object.keys(changes).join(', ') || 'no changes'}`);
    }
    return inputsConfigView();
  }

  // Toggling the listener is deliberately reachable by the Bearer (Companion) key: unlike
  // /api/config/*, it never reads or returns a passphrase, only name/port/enabled.
  async function setListener(name, enabled) {
    if (!inputs.find(name)) throw new HttpError(404, `unknown input: ${name}`);
    await guardNotRecording(name, 'changing the listener');
    await inputs.update(name, { enabled: Boolean(enabled) });
    const updated = inputs.find(name);
    log.info(`[inputs] listener ${name} ${updated.enabled ? 'enabled' : 'disabled'}`);
    return { name: updated.name, port: updated.port, enabled: updated.enabled };
  }

  async function inputRoutes(pathname, req) {
    const m = pathname.match(/^\/api\/inputs\/([^/]+)\/(record\/start|record\/stop|record\/toggle|clip|take|listener)$/);
    if (!m) throw new HttpError(404, 'not found');
    const name = decodeURIComponent(m[1]);
    const body = await readJson(req);
    switch (m[2]) {
      case 'record/start': return recording.start(name, { clip: body.clip });
      case 'record/stop': return recording.stop(name);
      case 'record/toggle': return recording.toggle(name, { clip: body.clip });
      case 'clip': return { clip: await recording.setClip(name, body.clip) };
      case 'listener': return setListener(name, body.enabled);
      default: return { nextTake: await recording.setNextTake(name, Number(body.next)) };
    }
  }

  // The sync token is for exactly one thing: the DMZ relay reading its input list (which carries
  // every camera passphrase). Anything else it asks for is refused, so a stolen relay-side token
  // can't record, toggle listeners, read the UI or change the registry.
  function syncRoute(req, res, pathname, ip) {
    const allowed = config.syncAllowedIps ?? [];
    if (allowed.length && !allowed.includes(ip.replace(/^::ffff:/, ''))) {
      log.error(`[auth] sync token used from ${ip}, not in SYNC_ALLOWED_IPS`);
      throw new HttpError(403, 'address not allowed');
    }
    if (req.method !== 'GET' || pathname !== '/api/relay/inputs') throw new HttpError(403, 'sync token is limited to GET /api/relay/inputs');
    log.info(`[audit] sync ${ip} GET ${pathname}`);
    return ok(res, { inputs: inputs.list() });
  }

  async function routeApi(req, res, url, authKind, ip) {
    const { pathname } = url;
    // The API key exists for Companion (status + record control). It must not read or change the
    // input registry: that API returns every camera's SRT passphrase.
    if (authKind === 'bearer' && pathname.startsWith('/api/config/')) throw new HttpError(403, 'API key cannot access /api/config');
    if (req.method === 'GET') {
      if (pathname === '/api/inputs') return ok(res, await recording.statuses());
      if (pathname === '/api/status') return ok(res, { shoot: state.get().shoot, clearedAt: state.get().clearedAt, inputs: await recording.statuses() });
      if (pathname === '/api/state') return ok(res, { shoot: state.get().shoot, clearedAt: state.get().clearedAt, recordingsShare: config.recordingsShare || null });
      if (pathname === '/api/recordings') return ok(res, await recordings(url.searchParams.get('all') === '1'));
      if (pathname === '/api/config/inputs') return ok(res, inputsConfigView());
      throw new HttpError(404, 'not found');
    }
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');

    // CSRF guard for cookie-less Basic auth in browsers: a custom header can't be sent cross-site
    // without a CORS preflight, which this server never approves. Bearer (API key) clients are
    // not ambient-credential based, so they're exempt.
    if (authKind === 'basic' && req.headers['x-c2c-request'] !== '1') throw new HttpError(403, 'missing X-C2C-Request header');

    log.info(`[audit] ${authKind} ${ip} ${req.method} ${pathname}`);

    if (pathname === '/api/shoot') {
      const s = await recording.setShoot((await readJson(req)).shoot);
      return ok(res, { shoot: s.shoot, clearedAt: s.clearedAt });
    }
    if (pathname === '/api/recordings/clear') {
      log.info('[state] recordings list cleared (files untouched)');
      const s = await state.update({ clearedAt: new Date().toISOString() });
      return ok(res, { shoot: s.shoot, clearedAt: s.clearedAt });
    }
    if (pathname === '/api/record/start-all') return ok(res, await recording.startAll());
    if (pathname === '/api/record/stop-all') return ok(res, await recording.stopAll());
    if (pathname.startsWith('/api/config/inputs')) return ok(res, await configRoutes(pathname, req));
    return ok(res, await inputRoutes(pathname, req));
  }

  async function serveStatic(res, urlPath) {
    const file = urlPath === '/' ? '/index.html' : urlPath;
    if (!STATIC_FILES.has(file)) return fail(res, 404, 'not found');
    const body = await readFile(join(publicDir, file));
    return send(res, 200, body, { 'Content-Type': STATIC_TYPES[extname(file)] });
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    if (pathname === '/healthz') return ok(res, { status: 'ok' });

    const ip = clientIp(req, config.trustProxy);
    const wait = throttle.retryAfter(ip);
    if (wait) return send(res, 429, 'too many failed logins — try again later', { 'Retry-After': String(wait) });

    const authKind = authenticate(req.headers, config);
    if (!authKind) {
      // A request with no credentials is just the browser's first visit; only wrong credentials count.
      if (req.headers.authorization) {
        const locked = throttle.fail(ip);
        log.error(`[auth] failed login from ${ip}${locked ? ' — locked out' : ''}`);
      }
      return send(res, 401, 'authentication required', { 'WWW-Authenticate': 'Basic realm="c2c-console", charset="UTF-8"' });
    }
    throttle.succeed(ip);

    if (authKind === 'sync') return syncRoute(req, res, pathname, ip);
    if (pathname === '/api/relay/inputs') throw new HttpError(403, 'only the relay sync token may read the relay input list');

    if (pathname.startsWith('/api/')) return routeApi(req, res, url, authKind, ip);

    const preview = req.method === 'GET' && config.omePreviewUrl ? parsePreviewPath(pathname, config.omeApp ?? 'app') : null;
    if (preview) {
      if (!inputs.find(preview.input)) return fail(res, 404, 'unknown input');
      return proxyPreview({ req, res, url, upstreamBase: config.omePreviewUrl, fetchImpl });
    }

    if (req.method === 'GET') return serveStatic(res, pathname);
    return fail(res, 404, 'not found');
  }

  return async function handler(req, res) {
    try {
      await route(req, res);
    } catch (err) {
      if (err instanceof HttpError) return fail(res, err.status, err.message);
      if (err instanceof InputConfigError) return fail(res, 400, err.message);
      log.error(`[http] ${req.method} ${req.url} failed: ${err.stack ?? err.message}`);
      if (!res.headersSent) fail(res, err.status && err.status < 500 ? err.status : 502, 'request failed — see console logs');
    }
  };
}
