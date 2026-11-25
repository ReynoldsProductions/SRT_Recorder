import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTestApp, AUTH, API_KEY, data } from './helpers.js';

let t;
before(async () => {
  t = await startTestApp({
    listRecordings: async () => [
      { path: 'Day1/cam1/old_T001.ts', sizeBytes: 1, modified: '2026-11-24T10:00:00.000Z' },
      { path: 'Day1/cam1/new_T001.ts', sizeBytes: 2, modified: '2026-11-24T12:00:00.000Z' },
    ],
  });
});
after(() => t.close());

test('auth: healthz open; Basic and Bearer accepted; others 401', async () => {
  assert.equal((await t.get('/healthz', {})).status, 200);
  assert.equal((await t.get('/api/inputs', {})).status, 401);
  assert.equal((await t.get('/api/inputs', { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await t.get('/api/inputs', { Authorization: `Bearer ${API_KEY}` })).status, 200);
  assert.equal((await t.get('/', {})).status, 401);
});

test('CSRF header required for Basic POSTs but not for Bearer', async () => {
  assert.equal((await t.post('/api/inputs/cam1/clip', { clip: 'x' }, { Authorization: AUTH, 'Content-Type': 'application/json' })).status, 403);
  const r = await t.post('/api/inputs/cam1/clip', { clip: 'bearer clip' }, { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.clip, 'bearer-clip');
});

test('static files with security headers; unknown paths 404', async () => {
  const r = await t.get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /media-src 'self' blob:/);
  assert.equal((await t.get('/../etc/passwd')).status, 404);
  assert.equal((await t.get('/api/nope')).status, 404);
  assert.equal((await fetch(`${t.base}/api/inputs`, { method: 'PUT', headers: { Authorization: AUTH } })).status, 405);
});

test('status reports live/none, clip, next take and next file', async () => {
  await t.post('/api/inputs/cam1/clip', { clip: 'interview' });
  const s = await data(t.get('/api/status'));
  assert.equal(s.shoot, 'Day1');
  const cam1 = s.inputs.find((i) => i.name === 'cam1');
  assert.equal(cam1.signal, 'live');
  assert.equal(cam1.clip, 'interview');
  assert.equal(cam1.nextTake, 1);
  assert.equal(cam1.nextFile, 'Day1/cam1/interview_T001_<time>.ts');
  assert.equal(s.inputs.find((i) => i.name === 'cam2').signal, 'none');
});

test('takes auto-increment per shoot/input/clip and can be reset', async () => {
  const a = await data(t.post('/api/inputs/cam1/record/start', { clip: 'interview' }));
  assert.match(a.outputFilePath, /^Day1\/cam1\/interview_T001_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.ts$/);
  assert.deepEqual(JSON.parse(t.ome.starts.at(-1).extra.metadata), { shoot: 'Day1', input: 'cam1', clip: 'interview', take: 1 });
  const status = await data(t.get('/api/inputs'));
  assert.equal(status[0].recording.take, 1);
  assert.ok(status[0].recording.elapsedMs >= 0);
  await t.post('/api/inputs/cam1/record/stop');
  const b = await data(t.post('/api/inputs/cam1/record/toggle'));
  assert.equal(b.take, 2);
  await t.post('/api/inputs/cam1/record/toggle');
  // different clip has its own counter
  const c = await data(t.post('/api/inputs/cam1/record/start', { clip: 'broll' }));
  assert.equal(c.take, 1);
  await t.post('/api/inputs/cam1/record/stop');
  await t.post('/api/inputs/cam1/clip', { clip: 'interview' });
  assert.equal((await data(t.post('/api/inputs/cam1/take', { next: 1 }))).nextTake, 1);
  assert.equal((await t.post('/api/inputs/cam1/take', { next: 0 })).status, 400);
  assert.equal((await t.post('/api/inputs/cam1/clip', { clip: '!!' })).status, 400);
});

test('record guards: no signal, double start, stop idle, unknown input', async () => {
  assert.match((await (await t.post('/api/inputs/cam2/record/start')).json()).error, /no signal/);
  assert.equal((await t.post('/api/inputs/cam9/record/start')).status, 404);
  assert.equal((await t.post('/api/inputs/cam1/record/stop')).status, 409);
  await t.post('/api/inputs/cam1/record/start');
  assert.equal((await t.post('/api/inputs/cam1/record/start')).status, 409);
  await t.post('/api/inputs/cam1/record/stop');
});

test('start-all / stop-all report per-input results', async () => {
  t.ome.live.add('cam2');
  const started = await data(t.post('/api/record/start-all'));
  assert.deepEqual(started.map((r) => [r.input, r.ok, Boolean(r.outputFilePath)]), [['cam1', true, true], ['cam2', true, true]]);
  const again = await data(t.post('/api/record/start-all'));
  assert.ok(again.every((r) => r.skipped === 'already recording'));
  const stopped = await data(t.post('/api/record/stop-all'));
  assert.ok(stopped.every((r) => r.ok && r.id));
  assert.ok((await data(t.post('/api/record/stop-all'))).every((r) => r.skipped === 'not recording'));
  t.ome.live.delete('cam2');
  assert.equal((await data(t.post('/api/record/start-all'))).find((r) => r.input === 'cam2').skipped, 'no signal');
  await t.post('/api/record/stop-all');
});

test('refuses to overwrite an existing file', async () => {
  const fixed = new Date(2026, 10, 24, 17, 0, 0);
  const t2 = await startTestApp({ clock: () => fixed });
  try {
    await mkdir(join(t2.recDir, 'Day1', 'cam1'), { recursive: true });
    await writeFile(join(t2.recDir, 'Day1', 'cam1', 'untitled_T001_2026-11-24_17-00-00.ts'), 'x');
    const r = await t2.post('/api/inputs/cam1/record/start');
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /already exists/);
    // take not consumed by the failed start
    assert.equal((await data(t2.get('/api/inputs')))[0].nextTake, 1);
  } finally {
    await t2.close();
  }
});

test('shoot: sanitized, clears list, blocked while recording, body validation', async () => {
  const r = await data(t.post('/api/shoot', { shoot: 'Acme Promo Day 2' }));
  assert.equal(r.shoot, 'Acme-Promo-Day-2');
  assert.ok(r.clearedAt);
  assert.equal((await t.post('/api/shoot', { shoot: '!!!' })).status, 400);
  assert.equal((await t.post('/api/shoot', 'not json')).status, 400);
  assert.equal((await t.post('/api/shoot', { shoot: 'x'.repeat(5000) })).status, 413);
  await t.post('/api/inputs/cam1/record/start');
  assert.equal((await t.post('/api/shoot', { shoot: 'Other' })).status, 409);
  await t.post('/api/inputs/cam1/record/stop');
  await t.post('/api/shoot', { shoot: 'Day1' });
});

test('recordings list honours clearedAt unless all=1; clear only hides', async () => {
  await t.state.update({ clearedAt: '2026-11-24T11:00:00.000Z' });
  assert.deepEqual((await data(t.get('/api/recordings'))).map((r) => r.path), ['Day1/cam1/new_T001.ts']);
  assert.equal((await data(t.get('/api/recordings?all=1'))).length, 2);
  await t.post('/api/recordings/clear');
  assert.equal((await data(t.get('/api/recordings'))).length, 0);
  await t.state.update({ clearedAt: null });
});

test('input config: add (auto port+passphrase), edit, regenerate, remove, guards', async () => {
  const view = await data(t.get('/api/config/inputs'));
  assert.equal(view.suggestedPort, 8899);
  assert.equal(view.inputs[0].camera.url, 'srt://10.0.0.5');
  const added = await data(t.post('/api/config/inputs', { name: 'Cam3', label: 'Wide' }));
  const cam3 = added.inputs.find((i) => i.name === 'cam3');
  assert.equal(cam3.port, 8899);
  assert.match(cam3.passphrase, /^[A-Za-z0-9]{24}$/);
  assert.equal(added.suggestedPort, null, 'range exhausted');
  assert.equal((await t.post('/api/config/inputs', { name: 'cam4' })).status, 400, 'no free port');
  assert.equal((await t.post('/api/config/inputs', { name: 'cam3', port: 8899 })).status, 400, 'duplicate');
  assert.equal((await t.post('/api/config/inputs', { name: '../x', port: 8899 })).status, 400);

  const edited = await data(t.post('/api/config/inputs/cam3', { label: 'Wide shot', latencyMs: 500 }));
  assert.equal(edited.inputs.find((i) => i.name === 'cam3').latencyMs, 500);
  assert.equal((await t.post('/api/config/inputs/cam3', { latencyMs: 5 })).status, 400);
  const regen = await data(t.post('/api/config/inputs/cam3/regenerate-passphrase'));
  assert.notEqual(regen.inputs.find((i) => i.name === 'cam3').passphrase, cam3.passphrase);

  // relay-affecting edits and removal are blocked while recording
  await t.post('/api/inputs/cam1/record/start');
  assert.equal((await t.post('/api/config/inputs/cam1', { latencyMs: 300 })).status, 409);
  assert.equal((await t.post('/api/config/inputs/cam1', { label: 'ok while recording' })).status, 200);
  assert.equal((await t.post('/api/config/inputs/cam1/delete')).status, 409);
  assert.equal((await t.post('/api/config/inputs/cam1/regenerate-passphrase')).status, 409);
  await t.post('/api/inputs/cam1/record/stop');

  const removed = await data(t.post('/api/config/inputs/cam3/delete'));
  assert.ok(!removed.inputs.some((i) => i.name === 'cam3'));
  assert.equal((await t.post('/api/config/inputs/cam3/delete')).status, 404);
  assert.equal((await t.post('/api/config/inputs')).status, 400);
});

test('relay status is merged into input status', async () => {
  const t3 = await startTestApp({ relayStatus: async () => [{ name: 'cam1', state: 'connected', since: 'x', sessions: 2, lastError: null }] });
  try {
    const [cam1, cam2] = await data(t3.get('/api/inputs'));
    assert.equal(cam1.relay.state, 'connected');
    assert.equal(cam2.relay.state, 'unknown');
  } finally {
    await t3.close();
  }
  const t4 = await startTestApp({ relayStatus: async () => { throw new Error('down'); } });
  try {
    assert.equal((await data(t4.get('/api/inputs')))[0].relay.state, 'unknown');
  } finally {
    await t4.close();
  }
});

test('preview proxy: authenticated, known inputs only', async () => {
  const r = await t.get('/app/cam1/llhls.m3u8?_HLS_msn=3');
  assert.equal(await r.text(), 'proxied http://ome:3333/app/cam1/llhls.m3u8?_HLS_msn=3');
  assert.equal((await t.get('/app/cam9/llhls.m3u8')).status, 404);
  assert.equal((await t.get('/app/cam1/llhls.m3u8', {})).status, 401);
});

test('OME outage degrades status to unknown; unexpected errors hide internals', async () => {
  const t5 = await startTestApp({ listRecordings: async () => { throw new Error('EACCES /secret/path'); } });
  try {
    const r = await t5.get('/api/recordings');
    assert.equal(r.status, 502);
    assert.doesNotMatch((await r.json()).error, /secret/);
  } finally {
    await t5.close();
  }
});
