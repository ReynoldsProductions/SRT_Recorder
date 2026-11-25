// Pure mapping from console status -> Companion variable definitions/values. No Companion imports,
// so it can be unit-tested directly.

import type { ConsoleStatus, InputStatus } from './api.js'

export type VariableValues = Record<string, string | number | boolean | undefined>

export const PER_INPUT_VARIABLES: ReadonlyArray<[suffix: string, name: string]> = [
	['label', 'label'],
	['port', 'relay port (camera port)'],
	['signal', 'signal: live / stalled / none / unknown'],
	['relay', 'relay: waiting / connected / disabled'],
	['recording', 'recording (true/false)'],
	['rec_time', 'recording elapsed (hh:mm:ss)'],
	['button_line', 'button text: "● T002 00:01:23" while recording, else "next T003"'],
	['rec_take', 'take being recorded (T###)'],
	['rec_file', 'file being recorded'],
	['clip', 'clip name'],
	['next_take', 'next take (T###)'],
	['next_take_number', 'next take number'],
	['next_file', 'next file name'],
	['resolution', 'resolution (e.g. 1920x1080)'],
	['fps', 'frame rate'],
	['bitrate_mbps', 'bitrate (Mbps)'],
]

export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return '00:00:00'
	const s = Math.floor(ms / 1000)
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

export const formatTake = (n: number | null | undefined): string => (n ? `T${String(n).padStart(3, '0')}` : '')

// Variable ids must be simple; console input names are already [a-z0-9_-].
export const varId = (input: string, suffix: string): string => `${input.replace(/[^a-z0-9_]/gi, '_')}_${suffix}`

export function variableDefinitions(inputNames: readonly string[]): Record<string, { name: string }> {
	const defs: Record<string, { name: string }> = {
		connected: { name: 'Console connected (true/false)' },
		shoot: { name: 'Current shoot (folder)' },
		inputs: { name: 'Input names (comma separated)' },
		recording_count: { name: 'Number of inputs recording' },
		any_recording: { name: 'Any input recording (true/false)' },
		last_error: { name: 'Last action error' },
	}
	for (const name of inputNames) {
		for (const [suffix, label] of PER_INPUT_VARIABLES) defs[varId(name, suffix)] = { name: `${name}: ${label}` }
	}
	return defs
}

function inputValues(i: InputStatus): VariableValues {
	const rec = i.recording
	return {
		[varId(i.name, 'label')]: i.label || i.name,
		[varId(i.name, 'port')]: i.port,
		[varId(i.name, 'signal')]: i.signal,
		[varId(i.name, 'relay')]: i.relay?.state ?? 'unknown',
		[varId(i.name, 'recording')]: Boolean(rec),
		[varId(i.name, 'rec_time')]: rec ? formatDuration(rec.elapsedMs) : '',
		[varId(i.name, 'button_line')]: rec
			? `● ${formatTake(rec.take)} ${formatDuration(rec.elapsedMs)}`.replace('●  ', '● ')
			: `next ${formatTake(i.nextTake)}`,
		[varId(i.name, 'rec_take')]: rec ? formatTake(rec.take) : '',
		[varId(i.name, 'rec_file')]: rec?.outputFilePath ?? '',
		[varId(i.name, 'clip')]: i.clip,
		[varId(i.name, 'next_take')]: formatTake(i.nextTake),
		[varId(i.name, 'next_take_number')]: i.nextTake,
		[varId(i.name, 'next_file')]: i.nextFile,
		[varId(i.name, 'resolution')]: i.video ? `${i.video.width}x${i.video.height}` : '',
		[varId(i.name, 'fps')]: i.video ? Math.round(i.video.fps * 100) / 100 : '',
		[varId(i.name, 'bitrate_mbps')]: i.bitrateBps ? Math.round(i.bitrateBps / 1e5) / 10 : 0,
	}
}

export function variableValues(status: ConsoleStatus): VariableValues {
	const recording = status.inputs.filter((i) => i.recording)
	return Object.assign(
		{
			connected: true,
			shoot: status.shoot,
			inputs: status.inputs.map((i) => i.name).join(','),
			recording_count: recording.length,
			any_recording: recording.length > 0,
		},
		...status.inputs.map(inputValues),
	)
}

// Values to publish when the console can't be reached.
export function disconnectedValues(inputNames: readonly string[]): VariableValues {
	return Object.assign(
		{ connected: false },
		...inputNames.map((n) => ({ [varId(n, 'signal')]: 'unknown', [varId(n, 'relay')]: 'unknown' })),
	)
}
