import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { buildFfmpegArgs, createSupervisor, redact } from '../src/relay/supervisor.js';
import { createManager } from '../src/relay/manager.js';

const quiet = { info() {}, error() {} };
const input = { name: 'cam2', port: 8898, passphrase: 'Abcdefghijkmnpqrstuvwxyz2', latencyMs: 1000, enabled: true, label: '' };
const target = { omeHost: 'ovenmediaengine', omePort: 9999, app: 'app' };

function fakeSpawn() {
  const children = [];
  const spawnImpl = (cmd, args) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    child.args = args;
    child.killed = false;
    child.kill = () => { child.killed = true; child.emit('exit', null); };
    children.push(child);
    return child;
  };
  return { spawnImpl, children };
}

test('ffmpeg args: listener with passphrase+latency, stream copy, OME stream id', () => {
  const args = buildFfmpegArgs(input, target);
  assert.ok(args.includes('srt://0.0.0.0:8898?mode=listener&latency=1000000&passphrase=Abcdefghijkmnpqrstuvwxyz2'));
  assert.deepEqual(args.slice(args.indexOf('-c'), args.indexOf('-c') + 2), ['-c', 'copy']);
  assert.match(args.at(-1), /^srt:\/\/ovenmediaengine:9999\?streamid=srt%3A%2F%2Fovenmediaengine%3A9999%2Fapp%2Fcam2&latency=200000$/);
  assert.ok(args.includes('-re'));
});

test('redact hides passphrases in log lines', () => {
  assert.equal(redact("from 'srt://0.0.0.0:1?passphrase=secret&x=1'"), "from 'srt://0.0.0.0:1?passphrase=<redacted>&x=1'");
});

test('supervisor tracks connect/disconnect, restarts, and redacts logs', async () => {
  const { spawnImpl, children } = fakeSpawn();
  const lines = [];
  const sup = createSupervisor({ input, target, spawnImpl, restartDelayMs: 5, log: { info: (l) => lines.push(l) } });
  sup.start();
  assert.equal(sup.status().state, 'waiting');
  children[0].stderr.emit('data', "Input #0, mpegts, from 'srt://0.0.0.0:8898?passphrase=Abcdefghijkmnpqrstuvwxyz2':\nConnection failed: rejected\n");
  assert.equal(sup.status().state, 'connected');
  assert.match(sup.status().lastError, /rejected/);
  assert.ok(lines.every((l) => !l.includes('Abcdefghijkmnpqrstuvwxyz2')), 'passphrase never logged');
  children[0].emit('exit', 0);
  assert.equal(sup.status().sessions, 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(children.length, 2, 'restarted after session');
  sup.stop();
  assert.equal(sup.status().state, 'stopped');
  assert.ok(children[1].killed);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(children.length, 2, 'no restart after stop');
});

test('manager reconciles adds, config changes, disables and removals; keeps relays on bad file', async () => {
  let current = [input, { ...input, name: 'cam3', port: 8899 }];
  let fail = false;
  const made = [];
  const makeSupervisor = ({ input: i }) => {
    const s = { input: i, started: false, stopped: false, start() { s.started = true; }, stop() { s.stopped = true; }, status: () => ({ name: i.name, state: 'waiting' }) };
    made.push(s);
    return s;
  };
  const errors = [];
  const m = createManager({ readInputs: async () => { if (fail) throw new Error('bad json'); return current; }, target, makeSupervisor, log: { info() {}, error: (e) => errors.push(e) } });
  await m.reconcile();
  assert.deepEqual(made.map((s) => [s.input.name, s.started]), [['cam2', true], ['cam3', true]]);
  await m.reconcile();
  assert.equal(made.length, 2, 'unchanged config → no restart');
  current = [{ ...input, latencyMs: 500 }, { ...input, name: 'cam3', port: 8899, enabled: false }];
  await m.reconcile();
  assert.ok(made[0].stopped && made[1].stopped);
  assert.equal(made.length, 3);
  assert.equal(made[2].input.latencyMs, 500);
  fail = true;
  await m.reconcile();
  await m.reconcile();
  assert.equal(errors.length, 1, 'error logged once');
  assert.ok(!made[2].stopped, 'running relay kept on bad file');
  assert.equal(m.status().error, 'bad json');
  fail = false;
  current = [];
  await m.reconcile();
  assert.ok(made[2].stopped);
  assert.deepEqual(m.status(), { error: null, inputs: [] });
  m.stopAll();
});
