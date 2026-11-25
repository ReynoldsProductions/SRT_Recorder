import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateStore } from '../src/state.js';

const quiet = { error() {} };

test('defaults when no file, persists updates atomically, reloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c2c-state-'));
  try {
    const path = join(dir, 'sub', 'state.json');
    const s = createStateStore(path, { log: quiet });
    assert.deepEqual(await s.load(), { shoot: 'unsorted', clearedAt: null, clips: {}, takes: {} });
    const before = s.get();
    await s.update({ shoot: 'Day1' });
    assert.equal(before.shoot, 'unsorted', 'previous state object is not mutated');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).shoot, 'Day1');
    const again = createStateStore(path, { log: quiet });
    assert.equal((await again.load()).shoot, 'Day1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('corrupt or wrongly-typed file falls back to defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c2c-state-'));
  try {
    const path = join(dir, 'state.json');
    await writeFile(path, '{not json');
    assert.equal((await createStateStore(path, { log: quiet }).load()).shoot, 'unsorted');
    await writeFile(path, JSON.stringify({ shoot: 42, clearedAt: 5 }));
    assert.deepEqual(await createStateStore(path, { log: quiet }).load(), { shoot: 'unsorted', clearedAt: null, clips: {}, takes: {} });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('functional updates are serialized: concurrent increments are not lost', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c2c-state-'));
  try {
    const s = createStateStore(join(dir, 'state.json'), { log: quiet });
    await s.load();
    await Promise.all(Array.from({ length: 20 }, () => s.update((cur) => ({ takes: { ...cur.takes, k: (cur.takes.k ?? 0) + 1 } }))));
    assert.equal(s.get().takes.k, 20);
    await s.update({ clips: { cam1: 'a', bad: 5 }, takes: { x: -1, y: 2.5, z: 3 } });
    assert.deepEqual(s.get().clips, { cam1: 'a' });
    assert.deepEqual(s.get().takes, { z: 3 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
