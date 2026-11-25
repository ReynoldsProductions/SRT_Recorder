import type { CompanionActionDefinitions, DropdownChoice } from '@companion-module/base'
import type ModuleInstance from './main.js'

const ALL = '__all__'

export type ActionsSchema = {
	record_start: { options: { input: string; clip: string } }
	record_stop: { options: { input: string } }
	record_toggle: { options: { input: string; clip: string } }
	set_shoot: { options: { shoot: string } }
	set_clip: { options: { input: string; clip: string } }
	set_next_take: { options: { input: string; take: string } }
	reset_take: { options: { input: string } }
	refresh: { options: Record<string, never> }
}

export function inputChoices(names: readonly string[], withAll: boolean): DropdownChoice<string>[] {
	const choices = names.map((n) => ({ id: n, label: n }))
	return withAll ? [{ id: ALL, label: 'All inputs' }, ...choices] : choices
}

export function UpdateActions(self: ModuleInstance): void {
	const names = self.inputNames()
	const first = names[0] ?? 'cam1'
	const inputField = (withAll: boolean) => ({
		id: 'input' as const,
		type: 'dropdown' as const,
		label: 'Input',
		choices: inputChoices(names, withAll),
		default: withAll ? ALL : first,
		allowCustom: true,
	})
	const clipField = {
		id: 'clip' as const,
		type: 'textinput' as const,
		label: 'Clip name (optional — blank keeps the current clip; variables allowed)',
		default: '',
		useVariables: true,
	}
	const targets = (input: string) => (input === ALL ? self.inputNames() : [input])

	const actions: CompanionActionDefinitions<ActionsSchema> = {
		record_start: {
			name: 'Start recording',
			description: 'Starts recording. The take number auto-increments; the file name comes from shoot/clip/take.',
			options: [inputField(true), { ...clipField, isVisibleExpression: `$(options:input) != '${ALL}'` }],
			callback: async ({ options }) =>
				self.run('start recording', async () => {
					if (options.input === ALL) return self.reportAll(await self.client().startAll())
					await self.client().start(options.input, options.clip.trim() || undefined)
				}),
		},
		record_stop: {
			name: 'Stop recording',
			options: [inputField(true)],
			callback: async ({ options }) =>
				self.run('stop recording', async () => {
					if (options.input === ALL) return self.reportAll(await self.client().stopAll())
					await self.client().stop(options.input)
				}),
		},
		record_toggle: {
			name: 'Toggle recording',
			options: [inputField(false), clipField],
			callback: async ({ options }) =>
				self.run('toggle recording', async () => {
					await self.client().toggle(options.input, options.clip.trim() || undefined)
				}),
		},
		set_shoot: {
			name: 'Set shoot (project folder)',
			description:
				'Recordings go to <shoot>/<input>/. Refused while anything is recording. Starting a new shoot clears the console list.',
			options: [
				{
					id: 'shoot',
					type: 'textinput',
					label: 'Shoot name (variables allowed, e.g. $(internal:date_y)-$(internal:date_m)-$(internal:date_d)_Promo)',
					default: '',
					useVariables: true,
				},
			],
			callback: async ({ options }) =>
				self.run('set shoot', async () => {
					await self.client().setShoot(options.shoot)
				}),
		},
		set_clip: {
			name: 'Set clip name',
			options: [inputField(true), { ...clipField, label: 'Clip name (variables allowed)' }],
			callback: async ({ options }) =>
				self.run('set clip', async () => {
					await Promise.all(targets(options.input).map(async (n) => self.client().setClip(n, options.clip)))
				}),
		},
		set_next_take: {
			name: 'Set next take number',
			options: [
				inputField(true),
				{
					id: 'take',
					type: 'textinput',
					label: 'Next take number (1-999, variables allowed)',
					default: '1',
					useVariables: true,
				},
			],
			callback: async ({ options }) =>
				self.run('set next take', async () => {
					const next = Number.parseInt(String(options.take).replace(/^T/i, ''), 10)
					await Promise.all(targets(options.input).map(async (n) => self.client().setNextTake(n, next)))
				}),
		},
		reset_take: {
			name: 'Reset take to T001',
			options: [inputField(true)],
			callback: async ({ options }) =>
				self.run('reset take', async () => {
					await Promise.all(targets(options.input).map(async (n) => self.client().setNextTake(n, 1)))
				}),
		},
		refresh: {
			name: 'Refresh status now',
			options: [],
			callback: async () => self.poll(),
		},
	}
	self.setActionDefinitions(actions)
}

export { ALL }
