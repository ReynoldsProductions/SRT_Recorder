import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThrottle } from '../src/throttle.js';

const make = (opts) => {
  let now = 1_000_000;
  const t = createThrottle({ maxFails: 3, windowMs: 60_000, lockMs: 30_000, clock: () => now, ...opts });
  return { t, tick: (ms) => { now += ms; } };
};

test('locks out after maxFails within the window, then releases', () => {
  const { t, tick } = make();
  assert.equal(t.fail('a'), false);
  assert.equal(t.fail('a'), false);
  assert.equal(t.retryAfter('a'), 0);
  assert.equal(t.fail('a'), true);
  assert.equal(t.retryAfter('a'), 30);
  tick(29_000);
  assert.equal(t.retryAfter('a'), 1);
  tick(1_000);
  assert.equal(t.retryAfter('a'), 0);
});

test('failures outside the window do not accumulate; clients are independent', () => {
  const { t, tick } = make();
  t.fail('a'); t.fail('a');
  tick(61_000);
  assert.equal(t.fail('a'), false);
  t.fail('b'); t.fail('b');
  assert.equal(t.retryAfter('a'), 0);
  assert.equal(t.retryAfter('b'), 0);
});

test('success clears the counter', () => {
  const { t } = make();
  t.fail('a'); t.fail('a');
  t.succeed('a');
  assert.equal(t.fail('a'), false);
  assert.equal(t.fail('a'), false);
});

test('memory is bounded: stale entries are pruned and new keys refused when full of live ones', () => {
  const { t, tick } = make({ maxKeys: 2 });
  t.fail('a'); t.fail('b');
  assert.equal(t.size(), 2);
  t.fail('c'); // full of live entries: not tracked
  assert.equal(t.size(), 2);
  tick(61_000);
  t.fail('c'); // old entries pruned to make room
  assert.equal(t.size(), 1);
});
