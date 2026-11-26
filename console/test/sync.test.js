// Relay config sync: a read-only, separately-credentialed endpoint the DMZ relay polls for its input list.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, AUTH, API_KEY, PP } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { authenticate } from '../src/auth.js';
import { createHttpInputsSource } from '../src/relay/sync-source.js';

const SYNC = 's'.repeat(40);
const sync = { Authorization: `Bearer ${SYNC}` };
const lines = { info: [], error: [] };
const log = { info: (m) => lines.info.push(m), error: (m) => lines.error.push(m) };

let t;
before(async () => {
  t = await startTestApp({ log, configExtra: { syncToken: SYNC, syncAllowedIps: [] } });
});
after(() => t.close());

// ---- config ---------------------------------------------------------------------------------

const baseEnv = { CONSOLE_PASSWORD: 'a-long-password', OME_API_URL: 'http://ome:8081/', OME_ACCESS_TOKEN: 't' };

test('config: SYNC_TOKEN must be long and distinct from the other credentials', () => {
  assert.equal(loadConfig(baseEnv).syncToken, null);
  assert.equal(loadConfig({ ...baseEnv, SYNC_TOKEN: SYNC }).syncToken, SYNC);
  assert.throws(() => loadConfig({ ...baseEnv, SYNC_TOKEN: 'short' }), /SYNC_TOKEN must be at least 32/);
  assert.throws(() => loadConfig({ ...baseEnv, API_KEY: SYNC, SYNC_TOKEN: SYNC }), /SYNC_TOKEN must differ from API_KEY/);
  assert.throws(
    () => loadConfig({ ...baseEnv, CONSOLE_PASSWORD: SYNC, SYNC_TOKEN: SYNC }),
    /SYNC_TOKEN must differ from CONSOLE_PASSWORD/,
  );
});

test('config: SYNC_ALLOWED_IPS is a comma list, empty means unrestricted', () => {
  assert.deepEqual(loadConfig(baseEnv).syncAllowedIps, []);
  assert.deepEqual(loadConfig({ ...baseEnv, SYNC_ALLOWED_IPS: ' 192.0.2.7 , 198.51.100.9 ' }).syncAllowedIps, ['192.0.2.7', '198.51.100.9']);
});

// ---- auth -----------------------------------------------------------------------------------

test('auth: sync token is its own kind and never matches the API key', () => {
  const cfg = { apiKey: API_KEY, syncToken: SYNC };
  assert.equal(authenticate({ authorization: `Bearer ${SYNC}` }, cfg), 'sync');
  assert.equal(authenticate({ authorization: `Bearer ${API_KEY}` }, cfg), 'bearer');
  assert.equal(authenticate({ authorization: `Bearer ${SYNC}x` }, cfg), null);
  assert.equal(authenticate({ authorization: `Bearer ${SYNC}` }, { apiKey: API_KEY, syncToken: null }), null);
});

// ---- endpoint -------------------------------------------------------------------------------

test('sync token reads the full input list (passphrases included, that is its job)', async () => {
  const res = await t.get('/api/relay/inputs', sync);
  assert.equal(res.status, 200);
  const { inputs } = (await res.json()).data;
  assert.deepEqual(inputs.map((i) => i.name).sort(), ['cam1', 'cam2']);
  assert.equal(inputs.find((i) => i.name === 'cam1').passphrase, PP);
  assert.equal(typeof inputs[0].enabled, 'boolean');
  assert.ok(lines.info.some((l) => /^\[audit\] sync 127\.0\.0\.1 GET \/api\/relay\/inputs$/.test(l)), 'syncs are audit-logged');
});

test('only the sync token may read /api/relay/inputs', async () => {
  assert.equal((await t.get('/api/relay/inputs', { Authorization: `Bearer ${API_KEY}` })).status, 403);
  assert.equal((await t.get('/api/relay/inputs', { Authorization: AUTH })).status, 403);
  assert.equal((await t.get('/api/relay/inputs', {})).status, 401);
});

test('sync token is useless anywhere else: no reads, no writes, no config, no UI', async () => {
  const h = { ...sync, 'Content-Type': 'application/json' };
  for (const path of ['/api/status', '/api/config/inputs', '/api/recordings', '/api/state', '/', '/index.html', '/app/cam1/llhls.m3u8']) {
    assert.equal((await t.get(path, h)).status, 403, `GET ${path}`);
  }
  assert.equal((await t.post('/api/inputs/cam1/listener', { enabled: false }, h)).status, 403);
  assert.equal((await t.post('/api/config/inputs', { name: 'x' }, h)).status, 403);
  assert.equal((await t.post('/api/record/start-all', {}, h)).status, 403);
  assert.equal(t.inputs.find('cam1').enabled, true, 'nothing changed');
});

test('a wrong sync token counts as a failed login and is locked out like any other', async () => {
  const locked = await startTestApp({
    log, configExtra: { syncToken: SYNC, syncAllowedIps: [] },
    throttle: (await import('../src/throttle.js')).createThrottle({ maxFails: 2, lockMs: 60_000 }),
  });
  try {
    const bad = { Authorization: `Bearer ${'x'.repeat(40)}` };
    assert.equal((await locked.get('/api/relay/inputs', bad)).status, 401);
    assert.equal((await locked.get('/api/relay/inputs', bad)).status, 401);
    assert.equal((await locked.get('/api/relay/inputs', sync)).status, 429);
  } finally {
    await locked.close();
  }
});

test('SYNC_TOKEN unset: the endpoint is closed to everyone', async () => {
  const off = await startTestApp({ log });
  try {
    assert.equal((await off.get('/api/relay/inputs', sync)).status, 401);
    assert.equal((await off.get('/api/relay/inputs', { Authorization: `Bearer ${API_KEY}` })).status, 403);
  } finally {
    await off.close();
  }
});

test('SYNC_ALLOWED_IPS restricts the sync token to listed addresses', async () => {
  const allow = await startTestApp({ log, configExtra: { syncToken: SYNC, syncAllowedIps: ['192.0.2.7'] } });
  try {
    lines.error.length = 0;
    assert.equal((await allow.get('/api/relay/inputs', sync)).status, 403);
    assert.ok(lines.error.some((l) => /sync token used from 127\.0\.0\.1, not in SYNC_ALLOWED_IPS/.test(l)));
  } finally {
    await allow.close();
  }
  const ok = await startTestApp({ log, configExtra: { syncToken: SYNC, syncAllowedIps: ['127.0.0.1', '192.0.2.7'] } });
  try {
    assert.equal((await ok.get('/api/relay/inputs', sync)).status, 200);
  } finally {
    await ok.close();
  }
});

// ---- relay side: the HTTP input source ------------------------------------------------------

const RANGE = { portMin: 8897, portMax: 8912 };
const wire = [{ name: 'cam1', label: '', port: 8897, passphrase: PP, latencyMs: 1000, enabled: true }];
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const source = (fetchImpl, extra = {}) =>
  createHttpInputsSource({ url: 'https://console.lan:3020/api/relay/inputs', token: SYNC, range: RANGE, fetchImpl, ...extra });

test('source: fetches with the bearer token and returns validated inputs', async () => {
  let seen;
  const read = source(async (u, init) => {
    seen = { u, auth: init.headers.Authorization, method: init.method ?? 'GET' };
    return jsonRes({ success: true, data: { inputs: wire }, error: null });
  });
  const inputs = await read();
  assert.equal(seen.u, 'https://console.lan:3020/api/relay/inputs');
  assert.equal(seen.auth, `Bearer ${SYNC}`);
  assert.equal(seen.method, 'GET');
  assert.equal(inputs[0].name, 'cam1');
  assert.equal(inputs[0].enabled, true);
});

test('source: every failure throws (so the manager keeps current relays), and never leaks the token', async () => {
  const cases = {
    'http 401': async () => jsonRes({ success: false, error: 'authentication required' }, 401),
    'http 500': async () => jsonRes({}, 500),
    'network down': async () => { throw new Error(`connect ECONNREFUSED (auth was Bearer ${SYNC})`); },
    'not json': async () => new Response('<html>', { status: 200 }),
    'wrong shape': async () => jsonRes({ success: true, data: {} }),
    'invalid input': async () => jsonRes({ success: true, data: { inputs: [{ ...wire[0], passphrase: 'short' }] } }),
    'port outside relay range': async () => jsonRes({ success: true, data: { inputs: [{ ...wire[0], port: 80 }] } }),
  };
  for (const [label, fetchImpl] of Object.entries(cases)) {
    await assert.rejects(source(fetchImpl)(), (err) => {
      assert.ok(!err.message.includes(SYNC), `${label}: error message must not contain the token`);
      return true;
    }, label);
  }
});

test('source: times out instead of hanging the reconcile loop', async () => {
  const hang = (u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(source(hang, { timeoutMs: 20 })(), /timed out|aborted/);
});

test('source: refuses plain http unless explicitly allowed', async () => {
  const mk = (extra) => createHttpInputsSource({ url: 'http://10.0.0.5:3020/api/relay/inputs', token: SYNC, range: RANGE, fetchImpl: async () => jsonRes({ data: { inputs: wire } }), ...extra });
  assert.throws(() => mk({}), /https|SYNC_ALLOW_INSECURE_HTTP/);
  assert.doesNotThrow(() => mk({ allowInsecureHttp: true }));
  assert.throws(() => createHttpInputsSource({ url: 'ftp://x', token: SYNC, range: RANGE }), /http/);
  assert.throws(() => createHttpInputsSource({ url: 'https://x/y', token: 'short', range: RANGE }), /token/);
});

// ---- end to end: relay manager -> sync source -> real console over HTTP -----------------------

test('e2e: toggling a listener on the console starts/stops that relay on the next sync, nothing else moves', async () => {
  const { createManager } = await import('../src/relay/manager.js');
  const started = [];
  const stopped = [];
  const makeSupervisor = ({ input }) => ({
    start: () => started.push(input.name),
    stop: () => stopped.push(input.name),
    status: () => ({ name: input.name }),
  });
  const read = createHttpInputsSource({ url: `${t.base}/api/relay/inputs`, token: SYNC, range: RANGE, allowInsecureHttp: true });
  const manager = createManager({ readInputs: read, target: {}, makeSupervisor, log: { info() {}, error() {} } });
  const bearer = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

  await manager.reconcile();
  assert.deepEqual(started.sort(), ['cam1', 'cam2'], 'both enabled inputs come up from the synced list');

  assert.equal((await t.post('/api/inputs/cam2/listener', { enabled: false }, bearer)).status, 200);
  await manager.reconcile();
  assert.deepEqual(stopped, ['cam2'], 'only cam2 stopped');
  assert.deepEqual(started.sort(), ['cam1', 'cam2'], 'cam1 was not restarted');

  assert.equal((await t.post('/api/inputs/cam2/listener', { enabled: true }, bearer)).status, 200);
  await manager.reconcile();
  assert.equal(started.filter((n) => n === 'cam2').length, 2, 'cam2 started again');
});

test('e2e: console unreachable keeps running relays up (a blip must not drop cameras)', async () => {
  const { createManager } = await import('../src/relay/manager.js');
  const stopped = [];
  let up = true;
  const inputs = [{ name: 'cam1', label: '', port: 8897, passphrase: PP, latencyMs: 1000, enabled: true }];
  const read = createHttpInputsSource({
    url: 'https://console.lan:3020/api/relay/inputs', token: SYNC, range: RANGE,
    fetchImpl: async () => { if (!up) throw new Error('connect ECONNREFUSED'); return jsonRes({ data: { inputs } }); },
  });
  const manager = createManager({
    readInputs: read, target: {}, log: { info() {}, error() {} },
    makeSupervisor: () => ({ start() {}, stop: () => stopped.push('cam1'), status: () => ({}) }),
  });
  await manager.reconcile();
  up = false;
  await manager.reconcile();
  assert.deepEqual(stopped, []);
  assert.match(manager.status().error, /sync request failed/);
});
