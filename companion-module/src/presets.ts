import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import { RED, GREEN, AMBER, WHITE, BLACK } from './feedbacks.js'
import { ALL } from './actions.js'
import { varId } from './state.js'

const GREY = 0x333333

export function UpdatePresets(self: ModuleInstance): void {
	const names = self.inputNames()
	const v = (id: string) => `$(${self.label}:${id})`
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}

	for (const name of names) {
		presets[`rec_${name}`] = {
			type: 'simple',
			name: `${name}: record toggle with tally`,
			style: {
				text: `${name.toUpperCase()}\n${v(varId(name, 'clip'))}\n${v(varId(name, 'button_line'))}`,
				size: '14',
				color: WHITE,
				bgcolor: BLACK,
			},
			steps: [{ down: [{ actionId: 'record_toggle', options: { input: name, clip: '' } }], up: [] }],
			feedbacks: [
				{ feedbackId: 'signal', options: { input: name, state: 'none' }, style: { bgcolor: GREY, color: WHITE } },
				{ feedbackId: 'recording', options: { input: name }, style: { bgcolor: RED, color: WHITE } },
			],
		}
		presets[`sig_${name}`] = {
			type: 'simple',
			name: `${name}: signal / format`,
			style: {
				text: `${name}\n${v(varId(name, 'resolution'))}\n${v(varId(name, 'fps'))}p ${v(varId(name, 'bitrate_mbps'))}M`,
				size: '14',
				color: WHITE,
				bgcolor: BLACK,
			},
			steps: [],
			feedbacks: [
				{ feedbackId: 'signal', options: { input: name, state: 'live' }, style: { bgcolor: GREEN, color: WHITE } },
				{ feedbackId: 'signal', options: { input: name, state: 'stalled' }, style: { bgcolor: AMBER, color: BLACK } },
			],
		}
		presets[`take_reset_${name}`] = {
			type: 'simple',
			name: `${name}: reset take`,
			style: { text: `${name}\nRESET TAKE\n${v(varId(name, 'next_take'))}`, size: '14', color: WHITE, bgcolor: BLACK },
			steps: [{ down: [{ actionId: 'reset_take', options: { input: name } }], up: [] }],
			feedbacks: [],
		}
	}

	presets.start_all = {
		type: 'simple',
		name: 'Start all',
		style: { text: '● REC ALL', size: '18', color: WHITE, bgcolor: BLACK },
		steps: [{ down: [{ actionId: 'record_start', options: { input: ALL, clip: '' } }], up: [] }],
		feedbacks: [{ feedbackId: 'recording', options: { input: ALL }, style: { bgcolor: RED, color: WHITE } }],
	}
	presets.stop_all = {
		type: 'simple',
		name: 'Stop all',
		style: { text: '■ STOP ALL', size: '18', color: WHITE, bgcolor: BLACK },
		steps: [{ down: [{ actionId: 'record_stop', options: { input: ALL } }], up: [] }],
		feedbacks: [],
	}
	presets.shoot = {
		type: 'simple',
		name: 'Shoot name + connection',
		style: { text: `SHOOT\n${v('shoot')}`, size: '14', color: WHITE, bgcolor: BLACK },
		steps: [],
		feedbacks: [{ feedbackId: 'connected', options: {}, isInverted: true, style: { bgcolor: RED, color: WHITE } }],
	}
	presets.shoot_today = {
		type: 'simple',
		name: "Set shoot to today's date",
		style: { text: 'SHOOT =\nTODAY', size: '14', color: WHITE, bgcolor: BLACK },
		steps: [
			{
				down: [
					{ actionId: 'set_shoot', options: { shoot: '$(internal:date_y)-$(internal:date_m)-$(internal:date_d)' } },
				],
				up: [],
			},
		],
		feedbacks: [],
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'recording',
			name: 'Recording',
			definitions: [
				{ id: 'all', name: 'All inputs', type: 'simple', presets: ['start_all', 'stop_all', 'shoot', 'shoot_today'] },
				...names.map((n) => ({
					id: `in_${n}`,
					name: n,
					type: 'simple' as const,
					presets: [`rec_${n}`, `sig_${n}`, `take_reset_${n}`],
				})),
			],
		},
	]
	self.setPresetDefinitions(structure, presets)
}
