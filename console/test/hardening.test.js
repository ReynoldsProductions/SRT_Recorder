import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, AUTH, API_KEY, PASS } from './helpers.js';
import { createThrottle } from '../src/throttle.js';
import { loadConfig } from '../src/config.js';

const lines = { info: [], error: [] };
const log = { info: (m) => lines.info.push(m), error: (m) => lines.error.push(m) };
const BAD = `Basic ${Buffer.from('engineer:wrong-password!').toString('base64')}`;

let t;
before(async () => {
  t = await startTestApp({ log, throttle: createThrottle({ maxFails: 3, lockMs: 60_000 }) });
});
after(() => t.close());

test('API key cannot read or change the input registry (passphrases)', async () => {
  const bearer = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };
  assert.equal((await t.get('/api/config/inputs', bearer)).status, 403);
  assert.equal((await t.post('/api/config/inputs', { name: 'cam3' }, bearer)).status, 403);
  assert.equal((await t.post('/api/config/inputs/cam1/regenerate-passphrase', {}, bearer)).status, 403);
  assert.equal((await t.post('/api/config/inputs/cam1/delete', {}, bearer)).status, 403);
  assert.ok(t.inputs.find('cam1'), 'cam1 still exists');
  // status and record control still work for Companion
  assert.equal((await t.get('/api/status', bearer)).status, 200);
  assert.equal((await t.post('/api/inputs/cam1/clip', { clip: 'ok' }, bearer)).status, 200);
  // the console user still can
  assert.equal((await t.get('/api/config/inputs')).status, 200);
});

test('mutating requests are audit-logged without bodies; reads are not', async () => {
  lines.info.length = 0;
  await t.post('/api/inputs/cam1/clip', { clip: 'secret-ish-clip' });
  await t.get('/api/status');
  const audit = lines.info.filter((l) => l.startsWith('[audit]'));
  assert.equal(audit.length, 1);
  assert.match(audit[0], /^\[audit\] basic 127\.0\.0\.1 POST \/api\/inputs\/cam1\/clip$/);
  assert.ok(!audit[0].includes('secret-ish-clip'));
});

test('repeated wrong credentials lock the client out, even with the right password', async () => {
  assert.equal((await t.get('/api/status', {})).status, 401); // no credentials: not counted
  for (let i = 0; i < 3; i += 1) assert.equal((await t.get('/api/status', { Authorization: BAD })).status, 401);
  const locked = await t.get('/api/status', { Authorization: AUTH });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  assert.ok(lines.error.some((l) => /failed login from 127\.0\.0\.1 — locked out/.test(l)));
  assert.equal((await t.get('/healthz', {})).status, 200, 'healthz stays reachable for container health checks');
});

test('X-Forwarded-For is ignored unless TRUST_PROXY is set', async () => {
  const mk = (configExtra) => startTestApp({ configExtra, throttle: createThrottle({ maxFails: 2, lockMs: 60_000 }) });
  const spoof = (n) => ({ Authorization: BAD, 'X-Forwarded-For': `203.0.113.${n}` });
  const good = (xff) => ({ Authorization: AUTH, ...(xff ? { 'X-Forwarded-For': xff } : {}) });

  const direct = await mk({});
  try {
    await direct.get('/api/status', spoof(1));
    await direct.get('/api/status', spoof(2)); // rotating the header does not dodge the lockout
    assert.equal((await direct.get('/api/status', good())).status, 429);
  } finally {
    await direct.close();
  }

  const proxied = await mk({ trustProxy: true });
  try {
    await proxied.get('/api/status', spoof(1));
    await proxied.get('/api/status', spoof(1)); // client .1 is locked out...
    assert.equal((await proxied.get('/api/status', good('203.0.113.1'))).status, 429);
    assert.equal((await proxied.get('/api/status', good('203.0.113.9'))).status, 200); // ...other clients are not
    // rightmost entry is the one our own proxy appended; earlier ones are client-controlled
    assert.equal((await proxied.get('/api/status', good('198.51.100.7, 203.0.113.1'))).status, 429);
    assert.equal((await proxied.get('/api/status', good('203.0.113.1, 198.51.100.7'))).status, 200);
  } finally {
    await proxied.close();
  }
});

test('config: port and relay range validation, TRUST_PROXY parsing', () => {
  const env = { CONSOLE_PASSWORD: PASS, OME_API_URL: 'http://ome:8081', OME_ACCESS_TOKEN: 't' };
  assert.throws(() => loadConfig({ ...env, PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ ...env, RELAY_PORT_MIN: '9000', RELAY_PORT_MAX: '8900' }), /RELAY_PORT/);
  assert.throws(() => loadConfig({ ...env, RELAY_PORT_MAX: 'x' }), /RELAY_PORT/);
  assert.equal(loadConfig(env).trustProxy, false);
  assert.equal(loadConfig({ ...env, TRUST_PROXY: '1' }).trustProxy, true);
  assert.equal(loadConfig({ ...env, TRUST_PROXY: 'no' }).trustProxy, false);
});
