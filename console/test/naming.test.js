import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeName, buildRecordingPaths, localStamp, previewFileName, takeKey, formatTake } from '../src/naming.js';

test('sanitizeName keeps safe chars, converts spaces, strips the rest', () => {
  assert.equal(sanitizeName('Interview A take 2'), 'Interview-A-take-2');
  assert.equal(sanitizeName('  café  b-roll  '), 'cafe-b-roll');
  assert.equal(sanitizeName('../../etc/passwd'), 'etcpasswd');
  assert.equal(sanitizeName('${StartTime:YYYY}'), 'StartTimeYYYY');
  assert.equal(sanitizeName('---x___'), 'x');
  assert.equal(sanitizeName(null), '');
  assert.equal(sanitizeName('a'.repeat(100)).length, 48);
});

test('buildRecordingPaths composes shoot/input/clip_Ttake_localtime', () => {
  const now = new Date(2026, 10, 24, 17, 5, 9);
  const p = buildRecordingPaths({ shoot: 'Acme Promo', clip: 'interview a', input: 'cam1', take: 3, now });
  assert.equal(p.filePath, 'Acme-Promo/cam1/interview-a_T003_2026-11-24_17-05-09.ts');
  assert.equal(p.infoPath, 'Acme-Promo/cam1/interview-a_T003_2026-11-24_17-05-09.xml');
  assert.equal(p.clip, 'interview-a');
  assert.equal(previewFileName({ shoot: 'Acme Promo', clip: 'interview a', input: 'cam1', take: 12 }), 'Acme-Promo/cam1/interview-a_T012_<time>.ts');
  assert.equal(takeKey({ shoot: 'Acme Promo', input: 'cam1', clip: '' }), 'Acme-Promo/cam1/untitled');
  assert.equal(formatTake(7), 'T007');
});

test('empty names fall back to unsorted/untitled', () => {
  const p = buildRecordingPaths({ shoot: '', clip: '!!!', input: 'cam2', now: new Date(2026, 0, 2, 3, 4, 5) });
  assert.equal(p.filePath, 'unsorted/cam2/untitled_T001_2026-01-02_03-04-05.ts');
  assert.equal(localStamp(new Date(2026, 0, 2, 3, 4, 5)), '2026-01-02_03-04-05');
});
