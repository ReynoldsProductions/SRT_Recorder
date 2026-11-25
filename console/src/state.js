// Persisted console state: current shoot, list-cleared time, per-input clip names and
// take counters. Clearing the list never touches files on disk.
//
// Updates are serialized (one at a time) so concurrent requests — e.g. Companion's
// "start all" — can't lose take increments.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_STATE = Object.freeze({ shoot: 'unsorted', clearedAt: null, clips: Object.freeze({}), takes: Object.freeze({}) });

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function stringMap(raw) {
  if (!isPlainObject(raw)) return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')));
}

function takeMap(raw) {
  if (!isPlainObject(raw)) return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.entries(raw).filter(([, v]) => Number.isInteger(v) && v >= 0)));
}

export function normalizeState(parsed) {
  return Object.freeze({
    shoot: typeof parsed?.shoot === 'string' && parsed.shoot ? parsed.shoot : DEFAULT_STATE.shoot,
    clearedAt: typeof parsed?.clearedAt === 'string' ? parsed.clearedAt : null,
    clips: stringMap(parsed?.clips),
    takes: takeMap(parsed?.takes),
  });
}

export function createStateStore(path, { log = console } = {}) {
  let current = DEFAULT_STATE;
  let queue = Promise.resolve();

  async function load() {
    try {
      current = normalizeState(JSON.parse(await readFile(path, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') log.error(`[state] could not read ${path}, using defaults: ${err.message}`);
      current = DEFAULT_STATE;
    }
    return current;
  }

  async function persist(next) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2));
    await rename(tmp, path); // atomic: a crash can't leave half-written JSON
  }

  // changes: a partial object, or a function (state) => partial object.
  function update(changes) {
    const run = async () => {
      const patch = typeof changes === 'function' ? changes(current) : changes;
      const next = normalizeState({ ...current, ...patch });
      await persist(next);
      current = next;
      return current;
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  return Object.freeze({ load, update, get: () => current });
}
