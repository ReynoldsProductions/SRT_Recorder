import type { SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	pollMs: number
}

export type ModuleSecrets = {
	apiKey: string
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'C2C Console',
			value:
				"Controls the Camera2Cloud SRT recording console. The API key is the console's API_KEY setting (C2C_API_KEY in its .env).",
			width: 12,
		},
		{ type: 'textinput', id: 'host', label: 'Console IP / host', width: 8, default: '' },
		{ type: 'number', id: 'port', label: 'Port', width: 4, min: 1, max: 65535, default: 3020 },
		{ type: 'secret-text', id: 'apiKey', label: 'API key', width: 12, minLength: 24 },
		{
			type: 'number',
			id: 'pollMs',
			label: 'Status poll interval (ms)',
			width: 6,
			min: 250,
			max: 10000,
			default: 1000,
		},
	]
}
