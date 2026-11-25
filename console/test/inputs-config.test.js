import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateInput, generatePassphrase, nextFreePort, createInputsStore, InputConfigError } from '../src/inputs-config.js';

const range = { portMin: 8897, portMax: 8900 };
const PP = 'Abcdefghijkmnpqrstuvwxyz2';
const quiet = { info() {}, error() {} };

test('generatePassphrase: 24 unambiguous alphanumerics, random', () => {
  const a = generatePassphrase();
  assert.match(a, /^[A-HJ-NP-Za-km-z2-9]{24}$/);
  assert.notEqual(a, generatePassphrase());
});

test('validateInput normalizes and enforces rules', () => {
  const v = validateInput({ name: 'CAM2 ', port: '8898', passphrase: PP }, { ...range });
  assert.deepEqual(v, { name: 'cam2', label: '', port: 8898, passphrase: PP, latencyMs: 1000, enabled: true });
  const bad = [
    [{ name: '', port: 8898, passphrase: PP }, /name/],
    [{ name: 'a/b', port: 8898, passphrase: PP }, /name/],
    [{ name: 'cam', port: 9000, passphrase: PP }, /range/],
    [{ name: 'cam', port: 8898, passphrase: 'short' }, /passphrase/],
    [{ name: 'cam', port: 8898, passphrase: `${PP}!` }, /passphrase/],
    [{ name: 'cam', port: 8898, passphrase: PP, latencyMs: 9000 }, /latency/],
  ];
  for (const [raw, re] of bad) assert.throws(() => validateInput(raw, { ...range }), re);
  const others = [{ name: 'cam1', port: 8897 }];
  assert.throws(() => validateInput({ name: 'cam1', port: 8898, passphrase: PP }, { others, ...range }), /already exists/);
  assert.throws(() => validateInput({ name: 'cam2', port: 8897, passphrase: PP }, { others, ...range }), /used by cam1/);
});

test('nextFreePort finds gaps and returns null when full', () => {
  assert.equal(nextFreePort([{ port: 8897 }, { port: 8899 }], range), 8898);
  assert.equal(nextFreePort([8897, 8898, 8899, 8900].map((port) => ({ port })), range), null);
});

test('store seeds on first run (mode 600), persists CRUD, name immutable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c2c-inputs-'));
  try {
    const path = join(dir, 'inputs.json');
    const s = createInputsStore(path, { ...range, seed: [{ name: 'cam1', port: 8897, passphrase: PP }], log: quiet });
    assert.equal((await s.load()).length, 1);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await s.add({ name: 'cam2' });
    assert.equal(s.find('cam2').port, 8898);
    await s.update('cam2', { label: 'B', name: 'hacked' });
    assert.equal(s.find('cam2').label, 'B');
    assert.equal(s.find('hacked'), null);
    await assert.rejects(s.update('nope', {}), InputConfigError);
    await assert.rejects(s.remove('nope'), InputConfigError);
    await s.remove('cam1');
    const reloaded = createInputsStore(path, { ...range, log: quiet });
    assert.deepEqual((await reloaded.load()).map((i) => i.name), ['cam2']);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).version, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('store rejects a corrupt file instead of silently replacing it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c2c-inputs-'));
  try {
    const path = join(dir, 'inputs.json');
    await writeFile(path, '{"inputs":[{"name":"x","port":1}]}');
    await assert.rejects(createInputsStore(path, { ...range, log: quiet }).load(), /invalid inputs file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
