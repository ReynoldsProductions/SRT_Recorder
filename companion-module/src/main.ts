import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { UpdateVariableDefinitions } from './variables.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { C2CClient, C2CError, type AllResult, type ConsoleStatus } from './api.js'
import { variableValues, disconnectedValues, type VariableValues } from './state.js'
import { UpgradeScripts } from './upgrades.js'

export { UpgradeScripts }

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariableValues
}

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	#secrets: ModuleSecrets = { apiKey: '' }
	#client: C2CClient | null = null
	#timer: NodeJS.Timeout | null = null
	#polling = false
	#status: ConsoleStatus | null = null
	#connected = false
	#inputNames: string[] = []

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		await this.configUpdated(config, secrets)
	}

	async destroy(): Promise<void> {
		this.#stopPolling()
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.#secrets = secrets ?? { apiKey: '' }
		this.#stopPolling()
		this.#status = null
		this.#connected = false
		this.#rebuildDefinitions()

		if (!config.host || !this.#secrets.apiKey) {
			this.#client = null
			this.updateStatus(InstanceStatus.BadConfig, 'Set the console host and API key')
			return
		}
		this.#client = new C2CClient({ host: config.host, port: config.port || 3020, apiKey: this.#secrets.apiKey })
		this.updateStatus(InstanceStatus.Connecting)
		await this.poll()
		this.#timer = setInterval(() => void this.poll(), Math.max(250, config.pollMs || 1000))
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	// ---- accessors used by actions / feedbacks / presets ----
	inputNames = (): string[] => this.#inputNames
	status = (): ConsoleStatus | null => this.#status
	isConnected = (): boolean => this.#connected

	client(): C2CClient {
		if (!this.#client) throw new C2CError('module not configured', 0)
		return this.#client
	}

	// Runs an action, logs failures, exposes them in $(label:last_error), then refreshes state.
	async run(what: string, fn: () => Promise<void>): Promise<void> {
		try {
			await fn()
			this.setVariableValues({ last_error: '' })
		} catch (err) {
			const msg = `${what}: ${(err as Error).message}`
			this.log('warn', msg)
			this.setVariableValues({ last_error: msg })
		}
		await this.poll()
	}

	reportAll(results: AllResult[]): void {
		const failed = results.filter((r) => !r.ok)
		if (failed.length) throw new C2CError(failed.map((r) => `${r.input}: ${r.error}`).join('; '), 409)
	}

	async poll(): Promise<void> {
		if (!this.#client || this.#polling) return
		this.#polling = true
		try {
			const status = await this.#client.status()
			const names = status.inputs.map((i) => i.name)
			this.#status = status
			if (names.join(',') !== this.#inputNames.join(',')) {
				this.#inputNames = names
				this.#rebuildDefinitions()
			}
			if (!this.#connected) {
				this.#connected = true
				this.updateStatus(InstanceStatus.Ok)
			}
			this.setVariableValues(variableValues(status))
		} catch (err) {
			if (this.#connected || this.#status === null) {
				const e = err as C2CError
				this.updateStatus(
					e.status === 401 ? InstanceStatus.AuthenticationFailure : InstanceStatus.ConnectionFailure,
					e.message,
				)
				this.log('warn', `status poll failed: ${e.message}`)
			}
			this.#connected = false
			this.#status = null
			this.setVariableValues(disconnectedValues(this.#inputNames))
		} finally {
			this.#polling = false
			this.checkAllFeedbacks()
		}
	}

	#rebuildDefinitions(): void {
		UpdateActions(this)
		UpdateFeedbacks(this)
		UpdateVariableDefinitions(this)
		UpdatePresets(this)
	}

	#stopPolling(): void {
		if (this.#timer) clearInterval(this.#timer)
		this.#timer = null
	}
}
