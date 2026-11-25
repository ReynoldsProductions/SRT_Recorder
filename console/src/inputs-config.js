// Input (camera) registry: name, relay port, SRT passphrase, latency, enabled.
// Stored in a JSON file shared by the console (read/write) and the relay manager (read-only).

import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomInt } from 'node:crypto';

export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const PASS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // no look-alikes (0/O, 1/l/I)
export const DEFAULTS = Object.freeze({ latencyMs: 1000, enabled: true });

export class InputConfigError extends Error {}

export function generatePassphrase(length = 24) {
  return Array.from({ length }, () => PASS_ALPHABET[randomInt(PASS_ALPHABET.length)]).join('');
}

// Validates one input definition against the others; returns a frozen normalized copy.
export function validateInput(raw, { others = [], portMin, portMax }) {
  const name = String(raw?.name ?? '').trim().toLowerCase();
  if (!NAME_RE.test(name)) throw new InputConfigError('name must be 1-24 chars: a-z, 0-9, "-" or "_", starting with a letter/digit');
  if (others.some((o) => o.name === name)) throw new InputConfigError(`an input named "${name}" already exists`);

  const port = Number(raw?.port);
  if (!Number.isInteger(port) || port < portMin || port > portMax) {
    throw new InputConfigError(`port must be in the relay range ${portMin}-${portMax}`);
  }
  const clash = others.find((o) => o.port === port);
  if (clash) throw new InputConfigError(`port ${port} is already used by ${clash.name}`);

  const passphrase = String(raw?.passphrase ?? '');
  // SRT allows 10-79 chars; Sony recommends 16+. Restrict charset so it can be typed on a camera/phone.
  if (!/^[A-Za-z0-9]{16,79}$/.test(passphrase)) throw new InputConfigError('passphrase must be 16-79 letters/digits');

  const latencyMs = raw?.latencyMs === undefined ? DEFAULTS.latencyMs : Number(raw.latencyMs);
  if (!Number.isInteger(latencyMs) || latencyMs < 20 || latencyMs > 8000) throw new InputConfigError('latency must be 20-8000 ms');

  const label = String(raw?.label ?? '').trim().slice(0, 48);
  const enabled = raw?.enabled === undefined ? DEFAULTS.enabled : Boolean(raw.enabled);
  return Object.freeze({ name, label, port, passphrase, latencyMs, enabled });
}

export function nextFreePort(inputs, { portMin, portMax }) {
  const used = new Set(inputs.map((i) => i.port));
  for (let p = portMin; p <= portMax; p += 1) if (!used.has(p)) return p;
  return null;
}

export function parseInputsFile(text, range) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed?.inputs) ? parsed.inputs : [];
  return list.reduce((acc, raw) => [...acc, validateInput(raw, { others: acc, ...range })], []);
}

export function createInputsStore(path, { portMin, portMax, seed = [], log = console }) {
  const range = { portMin, portMax };
  let inputs = Object.freeze([]);
  let queue = Promise.resolve();

  async function persist(next) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, inputs: next }, null, 2), { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  }

  async function load() {
    try {
      inputs = Object.freeze(parseInputsFile(await readFile(path, 'utf8'), range));
    } catch (err) {
      if (err.code !== 'ENOENT') throw new InputConfigError(`invalid inputs file ${path}: ${err.message}`);
      inputs = Object.freeze(seed.reduce((acc, raw) => [...acc, validateInput(raw, { others: acc, ...range })], []));
      await persist(inputs);
      log.info(`[inputs] created ${path} with ${inputs.length} seeded input(s)`);
    }
    return inputs;
  }

  // Serialized read-modify-write. fn(current) => next array (already validated).
  function mutate(fn) {
    const run = async () => {
      const next = Object.freeze(fn(inputs));
      await persist(next);
      inputs = next;
      return inputs;
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  const find = (name) => inputs.find((i) => i.name === name) ?? null;

  return Object.freeze({
    load,
    list: () => inputs,
    find,
    range,
    suggestPort: () => nextFreePort(inputs, range),
    add: (raw) =>
      mutate((cur) => {
        const port = raw?.port ?? nextFreePort(cur, range);
        const passphrase = raw?.passphrase || generatePassphrase();
        return [...cur, validateInput({ ...raw, port, passphrase }, { others: cur, ...range })];
      }),
    update: (name, changes) =>
      mutate((cur) => {
        const existing = cur.find((i) => i.name === name);
        if (!existing) throw new InputConfigError(`unknown input: ${name}`);
        const others = cur.filter((i) => i.name !== name);
        // Renaming would orphan take counters/recordings paths; name is immutable.
        const updated = validateInput({ ...existing, ...changes, name }, { others, ...range });
        return cur.map((i) => (i.name === name ? updated : i));
      }),
    remove: (name) =>
      mutate((cur) => {
        if (!cur.some((i) => i.name === name)) throw new InputConfigError(`unknown input: ${name}`);
        return cur.filter((i) => i.name !== name);
      }),
  });
}
