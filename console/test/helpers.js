// Shared test wiring: real stores + recording service against a fake OME.
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createStateStore } from '../src/state.js';
import { createInputsStore } from '../src/inputs-config.js';
import { createRecordingService } from '../src/recording.js';
import { streamInfo, streamStats, recordingRecord } from './fixtures.js';

export const quietLog = { info() {}, error() {} };
export const PASS = 'correct-horse-battery';
export const API_KEY = 'k'.repeat(32);
export const AUTH = `Basic ${Buffer.from(`engineer:${PASS}`).toString('base64')}`;
export const PP = 'Abcdefghijkmnpqrstuvwxyz2';

export function fakeOme(ome) {
  return {
    getStream: async (n) => (ome.live.has(n) ? streamInfo : null),
    getStreamStats: async (n) => (ome.live.has(n) ? streamStats(new Date().toISOString()) : null),
    listRecords: async () => ome.records,
    startRecord: async (name, id, extra = {}) => {
      ome.starts.push({ name, id, extra });
      const rec = { ...recordingRecord, id, stream: { name }, outputFilePath: extra.filePath, metadata: extra.metadata, startTime: new Date().toISOString() };
      ome.records = [...ome.records, rec];
      return rec;
    },
    stopRecord: async (id) => {
      ome.records = ome.records.filter((r) => r.id !== id);
      return { id, state: 'stopping' };
    },
  };
}

export async function startTestApp({ clock, listRecordings = async () => [], relayStatus, throttle, log = quietLog, configExtra = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'c2c-app-'));
  const publicDir = join(dir, 'public');
  const recDir = join(dir, 'rec');
  await Promise.all([import('node:fs/promises').then((f) => f.mkdir(publicDir)), import('node:fs/promises').then((f) => f.mkdir(recDir))]);
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>t</title>');
  const config = {
    consoleUser: 'engineer', consolePassword: PASS, apiKey: API_KEY, staleAfterMs: 5000, omeApp: 'app',
    omePreviewUrl: 'http://ome:3333', recordingsDir: recDir, publicHost: '10.0.0.5', relayPortMin: 8897, relayPortMax: 8899, ...configExtra,
  };
  const ome = { live: new Set(['cam1']), records: [], starts: [] };
  const state = createStateStore(join(dir, 'state.json'), { log: quietLog });
  await state.load();
  await state.update({ shoot: 'Day1' });
  // enabled: true — these fixtures represent already-configured, active cameras. The
  // enabled-defaults-to-false behavior itself is covered in inputs-config.test.js.
  const inputs = createInputsStore(join(dir, 'inputs.json'), { portMin: 8897, portMax: 8899, seed: [{ name: 'cam1', port: 8897, passphrase: PP, enabled: true }, { name: 'cam2', port: 8898, passphrase: PP, enabled: true }], log: quietLog });
  await inputs.load();
  const recording = createRecordingService({ config, ome: fakeOme(ome), state, inputs, relayStatus, clock, log: quietLog });
  const fetchImpl = async (u) => new Response(`proxied ${u}`, { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
  const server = createServer(createApp({ config, recording, inputs, state, publicDir, listRecordings, fetchImpl, log, ...(throttle ? { throttle } : {}) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, headers = { Authorization: AUTH }) => fetch(base + path, { headers });
  const post = (path, body, headers = { Authorization: AUTH, 'X-C2C-Request': '1', 'Content-Type': 'application/json' }) =>
    fetch(base + path, { method: 'POST', headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const close = async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  };
  return { base, get, post, close, ome, state, inputs, recDir, dir };
}

export const data = async (resP) => (await (await resP).json()).data;
