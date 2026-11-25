import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	variableDefinitions,
	variableValues,
	disconnectedValues,
	formatDuration,
	formatTake,
	varId,
} from '../dist/state.js'

const status = {
	shoot: '2026-11-24_Promo',
	clearedAt: null,
	inputs: [
		{
			name: 'cam1',
			label: 'FX2 A',
			port: 8897,
			enabled: true,
			signal: 'live',
			relay: { state: 'connected' },
			video: { codec: 'H264', width: 3840, height: 2160, fps: 59.94 },
			bitrateBps: 40023800,
			clip: 'interview',
			nextTake: 3,
			nextFile: '2026-11-24_Promo/cam1/interview_T003_<time>.ts',
			recording: {
				id: 'r',
				state: 'recording',
				take: 2,
				startTime: 'x',
				elapsedMs: 83500,
				recordBytes: 1,
				outputFilePath: '2026-11-24_Promo/cam1/interview_T002_x.ts',
			},
		},
		{
			name: 'cam-2',
			label: '',
			port: 8898,
			enabled: true,
			signal: 'none',
			relay: { state: 'waiting' },
			video: null,
			bitrateBps: 0,
			clip: 'untitled',
			nextTake: 1,
			nextFile: 'x',
			recording: null,
		},
	],
}

test('formatting helpers', () => {
	assert.equal(formatDuration(83500), '00:01:23')
	assert.equal(formatDuration(-1), '00:00:00')
	assert.equal(formatTake(7), 'T007')
	assert.equal(formatTake(null), '')
	assert.equal(varId('cam-2', 'clip'), 'cam_2_clip')
})

test('definitions include globals and every per-input variable', () => {
	const defs = variableDefinitions(['cam1', 'cam-2'])
	for (const k of ['connected', 'shoot', 'recording_count', 'cam1_rec_time', 'cam1_button_line', 'cam_2_next_file'])
		assert.ok(defs[k], k)
})

test('values map recording and idle inputs', () => {
	const v = variableValues(status)
	assert.equal(v.shoot, '2026-11-24_Promo')
	assert.equal(v.recording_count, 1)
	assert.equal(v.any_recording, true)
	assert.equal(v.cam1_recording, true)
	assert.equal(v.cam1_rec_time, '00:01:23')
	assert.equal(v.cam1_rec_take, 'T002')
	assert.equal(v.cam1_button_line, '● T002 00:01:23')
	assert.equal(v.cam1_next_take, 'T003')
	assert.equal(v.cam1_resolution, '3840x2160')
	assert.equal(v.cam1_bitrate_mbps, 40)
	assert.equal(v.cam_2_label, 'cam-2')
	assert.equal(v.cam_2_recording, false)
	assert.equal(v.cam_2_button_line, 'next T001')
	assert.equal(v.cam_2_resolution, '')
})

test('disconnected values flag connection and unknown signal', () => {
	assert.deepEqual(disconnectedValues(['cam1']), { connected: false, cam1_signal: 'unknown', cam1_relay: 'unknown' })
})
