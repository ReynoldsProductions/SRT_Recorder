// Recording service: per-input status, start/stop (single and all), clip names and take counters.
// Owns the naming rules so the browser and Companion get identical behavior.

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { summarizeInput, activeRecordFor, newRecordId } from './inputs.js';
import { sanitizeName, buildRecordingPaths, previewFileName, takeKey } from './naming.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const exists = (path) => access(path).then(() => true, () => false);

// inputs: { list(), find(name) } — the live input registry (can change at runtime).
// relayStatus: async () => [{ name, state, since, sessions, lastError }] (optional).
export function createRecordingService({ config, ome, state, inputs, relayStatus = async () => [], clock = () => new Date(), log = console }) {
  const busy = new Set(); // inputs with a start/stop in flight

  function requireInput(name) {
    const input = inputs.find(name);
    if (!input) throw new HttpError(404, `unknown input: ${name}`);
    return input;
  }

  const clipFor = (s, name) => sanitizeName(s.clips[name]) || 'untitled';
  const nextTakeFor = (s, name, clip = clipFor(s, name)) =>
    (s.takes[takeKey({ shoot: s.shoot, input: name, clip })] ?? 0) + 1;

  function decorate(summary, s, now, input, relay) {
    const clip = clipFor(s, summary.name);
    const nextTake = nextTakeFor(s, summary.name, clip);
    const rec = summary.recording;
    return {
      ...summary,
      label: input.label || '',
      enabled: input.enabled,
      latencyMs: input.latencyMs,
      relay: relay ? { state: relay.state, since: relay.since, sessions: relay.sessions, lastError: relay.lastError } : { state: input.enabled ? 'unknown' : 'disabled' },
      clip,
      nextTake,
      nextFile: previewFileName({ shoot: s.shoot, clip, input: summary.name, take: nextTake }),
      recording: rec ? { ...rec, elapsedMs: rec.startTime ? Math.max(0, now - Date.parse(rec.startTime)) : 0 } : null,
    };
  }

  async function statuses() {
    const records = await ome.listRecords().catch((err) => {
      log.error(`[ome] listRecords failed: ${err.message}`);
      return [];
    });
    const relays = await relayStatus().catch((err) => {
      log.error(`[relay] status unavailable: ${err.message}`);
      return [];
    });
    const relayByName = new Map(relays.map((r) => [r.name, r]));
    const s = state.get();
    const now = clock().getTime();
    return Promise.all(
      inputs.list().map(async (input) => {
        const relay = relayByName.get(input.name);
        try {
          const [info, stats] = await Promise.all([ome.getStream(input.name), ome.getStreamStats(input.name)]);
          return decorate(summarizeInput(input, { info, stats, records, now, staleAfterMs: config.staleAfterMs }), s, now, input, relay);
        } catch (err) {
          log.error(`[ome] status for ${input.name} failed: ${err.message}`);
          return decorate({ ...summarizeInput(input, { records }), signal: 'unknown', error: 'OME unavailable' }, s, now, input, relay);
        }
      }),
    );
  }

  async function withLock(name, fn) {
    if (busy.has(name)) throw new HttpError(409, `${name} is busy — try again`);
    busy.add(name);
    try {
      return await fn();
    } finally {
      busy.delete(name);
    }
  }

  async function setClip(name, clip) {
    requireInput(name);
    const clean = sanitizeName(clip);
    if (!clean) throw new HttpError(400, 'clip name must contain letters or digits');
    await state.update((s) => ({ clips: { ...s.clips, [name]: clean } }));
    return clean;
  }

  // Sets the take number the NEXT recording of this input's current clip will use.
  async function setNextTake(name, next) {
    requireInput(name);
    if (!Number.isInteger(next) || next < 1 || next > 999) throw new HttpError(400, 'next take must be an integer 1-999');
    const s = await state.update((cur) => {
      const key = takeKey({ shoot: cur.shoot, input: name, clip: clipFor(cur, name) });
      return { takes: { ...cur.takes, [key]: next - 1 } };
    });
    return nextTakeFor(s, name);
  }

  async function start(name, { clip } = {}) {
    requireInput(name);
    return withLock(name, async () => {
      if (clip !== undefined && clip !== null && String(clip).trim() !== '') await setClip(name, clip);
      const info = await ome.getStream(name);
      if (!info) throw new HttpError(409, `no signal on ${name} — cannot start recording`);
      const existing = activeRecordFor(await ome.listRecords(), name);
      if (existing) throw new HttpError(409, `${name} is already recording (${existing.id})`);

      const s = state.get();
      const clipName = clipFor(s, name);
      const take = nextTakeFor(s, name, clipName);
      const paths = buildRecordingPaths({ shoot: s.shoot, clip: clipName, input: name, take, now: clock() });
      if (await exists(join(config.recordingsDir, paths.filePath))) {
        throw new HttpError(409, `${paths.filePath} already exists — wait a second and retry`);
      }
      const metadata = JSON.stringify({ shoot: paths.shoot, input: name, clip: paths.clip, take });
      const rec = await ome.startRecord(name, newRecordId(name, clock()), { filePath: paths.filePath, infoPath: paths.infoPath, metadata });
      // Only consume the take once OME has actually started recording.
      await state.update((cur) => ({ takes: { ...cur.takes, [takeKey({ shoot: paths.shoot, input: name, clip: paths.clip })]: take } }));
      log.info(`[record] start ${name} id=${rec.id} file=${paths.filePath}`);
      return { input: name, id: rec.id, state: rec.state, take, outputFilePath: rec.outputFilePath ?? paths.filePath };
    });
  }

  async function stop(name) {
    requireInput(name);
    return withLock(name, async () => {
      const existing = activeRecordFor(await ome.listRecords(), name);
      if (!existing) throw new HttpError(409, `${name} is not recording`);
      const rec = await ome.stopRecord(existing.id);
      log.info(`[record] stop ${name} id=${existing.id}`);
      return { input: name, id: existing.id, state: rec?.state ?? 'stopping', outputFilePath: existing.outputFilePath };
    });
  }

  async function toggle(name, opts) {
    requireInput(name);
    const recording = activeRecordFor(await ome.listRecords(), name);
    return recording ? stop(name) : start(name, opts);
  }

  // Applies fn to every input; never throws — returns per-input results for the caller to show.
  async function forAll(fn) {
    const results = await Promise.all(
      inputs.list().map(async ({ name }) => {
        try {
          return { input: name, ok: true, ...(await fn(name)) };
        } catch (err) {
          return { input: name, ok: false, error: err.message };
        }
      }),
    );
    return results;
  }

  async function startAll() {
    const records = await ome.listRecords();
    return forAll(async (name) => {
      if (activeRecordFor(records, name)) return { skipped: 'already recording' };
      if (!(await ome.getStream(name))) return { skipped: 'no signal' };
      return start(name);
    });
  }

  async function stopAll() {
    const records = await ome.listRecords();
    return forAll(async (name) => (activeRecordFor(records, name) ? stop(name) : { skipped: 'not recording' }));
  }

  async function setShoot(raw) {
    const shoot = sanitizeName(raw);
    if (!shoot) throw new HttpError(400, 'shoot name must contain letters or digits');
    const records = await ome.listRecords();
    if (inputs.list().some(({ name }) => activeRecordFor(records, name))) {
      throw new HttpError(409, 'stop all recordings before changing the shoot');
    }
    if (shoot === state.get().shoot) return state.get();
    log.info(`[state] new shoot "${shoot}"`);
    return state.update({ shoot, clearedAt: clock().toISOString() });
  }

  const isRecording = async (name) => Boolean(activeRecordFor(await ome.listRecords(), name));

  return Object.freeze({ statuses, start, stop, toggle, startAll, stopAll, setClip, setNextTake, setShoot, isRecording });
}
