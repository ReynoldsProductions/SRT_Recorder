import { combineRgb, type CompanionFeedbackDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { inputChoices, ALL } from './actions.js'

export type FeedbacksSchema = {
	recording: { type: 'boolean'; options: { input: string } }
	signal: { type: 'boolean'; options: { input: string; state: string } }
	connected: { type: 'boolean'; options: Record<string, never> }
}

export const RED = combineRgb(204, 0, 0)
export const GREEN = combineRgb(0, 153, 51)
export const AMBER = combineRgb(204, 136, 0)
export const WHITE = combineRgb(255, 255, 255)
export const BLACK = combineRgb(0, 0, 0)

export function UpdateFeedbacks(self: ModuleInstance): void {
	const names = self.inputNames()
	const feedbacks: CompanionFeedbackDefinitions<FeedbacksSchema> = {
		recording: {
			type: 'boolean',
			name: 'Recording (tally)',
			description: 'True while the input (or any input) is recording.',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [
				{
					id: 'input',
					type: 'dropdown',
					label: 'Input',
					choices: [{ id: ALL, label: 'Any input' }, ...inputChoices(names, false)],
					default: names[0] ?? ALL,
					allowCustom: true,
				},
			],
			callback: ({ options }) => {
				const inputs = self.status()?.inputs ?? []
				return options.input === ALL
					? inputs.some((i) => i.recording)
					: Boolean(inputs.find((i) => i.name === options.input)?.recording)
			},
		},
		signal: {
			type: 'boolean',
			name: 'Signal state',
			options: [
				{
					id: 'input',
					type: 'dropdown',
					label: 'Input',
					choices: inputChoices(names, false),
					default: names[0] ?? 'cam1',
					allowCustom: true,
				},
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					default: 'live',
					choices: [
						{ id: 'live', label: 'Live' },
						{ id: 'stalled', label: 'Stalled' },
						{ id: 'none', label: 'No signal' },
						{ id: 'unknown', label: 'Unknown' },
					],
				},
			],
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			callback: ({ options }) =>
				(self.status()?.inputs.find((i) => i.name === options.input)?.signal ?? 'unknown') === options.state,
		},
		connected: {
			type: 'boolean',
			name: 'Console connected',
			options: [],
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			callback: () => self.isConnected(),
		},
	}
	self.setFeedbackDefinitions(feedbacks)
}
