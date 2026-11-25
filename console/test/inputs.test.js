import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeInput, activeRecordFor, newRecordId, summarizeVideo, summarizeAudio } from '../src/inputs.js';
import { streamInfo, streamStats, recordingRecord } from './fixtures.js';

const input = { name: 'cam1', port: 8897 };
const now = Date.parse('2026-11-25T00:52:28.000Z');

test('live stream is summarized from OME tracks', () => {
  const s = summarizeInput(input, { info: streamInfo, stats: streamStats('2026-11-25T00:52:27.308+00:00'), records: [], now });
  assert.equal(s.signal, 'live');
  assert.deepEqual(s.video, { codec: 'H264', width: 3840, height: 2160, fps: 30, bitrateBps: 21507088, keyFrameInterval: 60 });
  assert.deepEqual(s.audio, { codec: 'AAC', channels: 2, sampleRate: 48000, bitrateBps: 129307 });
  assert.equal(s.bitrateBps, 21507088 + 129307);
  assert.equal(s.recording, null);
});

test('stream with old lastRecvTime is stalled', () => {
  const s = summarizeInput(input, { info: streamInfo, stats: streamStats('2026-11-25T00:52:00.000Z'), records: [], now, staleAfterMs: 5000 });
  assert.equal(s.signal, 'stalled');
});

test('missing stream is "none" but still reports recording state', () => {
  const s = summarizeInput(input, { info: null, stats: null, records: [recordingRecord] });
  assert.equal(s.signal, 'none');
  assert.equal(s.video, null);
  assert.equal(s.recording.id, 'cam1-20261125T004747Z');
});

test('activeRecordFor ignores other streams and finished records', () => {
  assert.equal(activeRecordFor([{ ...recordingRecord, stream: { name: 'cam2' } }], 'cam1'), null);
  assert.equal(activeRecordFor([{ ...recordingRecord, state: 'ready' }], 'cam1'), null);
  assert.equal(activeRecordFor(undefined, 'cam1'), null);
  assert.equal(activeRecordFor([recordingRecord], 'cam1').recordTimeMs, 5000);
  assert.equal(activeRecordFor([{ ...recordingRecord, metadata: '{"take":4}' }], 'cam1').take, 4);
  assert.equal(activeRecordFor([{ ...recordingRecord, metadata: 'clip=x' }], 'cam1').take, null);
});

test('summarizers handle missing tracks and fall back to averages', () => {
  assert.equal(summarizeVideo(null), null);
  assert.equal(summarizeAudio(undefined), null);
  assert.equal(summarizeVideo({ codec: 'H265', width: 1920, height: 1080, framerate: 59.94, bitrate: 9e6 }).fps, 59.94);
});

test('newRecordId is stream-prefixed compact UTC', () => {
  assert.equal(newRecordId('cam1', new Date('2026-11-25T00:47:47.976Z')), 'cam1-20261125T004747Z');
});
