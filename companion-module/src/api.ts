// HTTP client for the C2C console API (Bearer API key). fetch is injectable for tests.

export interface RecordingInfo {
	id: string
	state: string
	take: number | null
	startTime: string | null
	elapsedMs: number
	recordBytes: number
	outputFilePath: string | null
}

export interface InputStatus {
	name: string
	label: string
	port: number
	enabled: boolean
	signal: 'live' | 'stalled' | 'none' | 'unknown'
	relay: { state: string }
	video: { codec: string; width: number; height: number; fps: number } | null
	bitrateBps: number
	clip: string
	nextTake: number
	nextFile: string
	recording: RecordingInfo | null
}

export interface ConsoleStatus {
	shoot: string
	clearedAt: string | null
	inputs: InputStatus[]
}

export interface AllResult {
	input: string
	ok: boolean
	skipped?: string
	error?: string
	outputFilePath?: string
}

export class C2CError extends Error {
	readonly status: number
	constructor(message: string, status: number) {
		super(message)
		this.status = status
	}
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export class C2CClient {
	readonly #base: string
	readonly #apiKey: string
	readonly #fetch: FetchLike
	readonly #timeoutMs: number

	constructor(opts: { host: string; port: number; apiKey: string; fetchImpl?: FetchLike; timeoutMs?: number }) {
		this.#base = `http://${opts.host}:${opts.port}`
		this.#apiKey = opts.apiKey
		this.#fetch = opts.fetchImpl ?? (async (url, init) => fetch(url, init))
		this.#timeoutMs = opts.timeoutMs ?? 4000
	}

	async #call<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
		let res: Response
		try {
			res = await this.#fetch(`${this.#base}${path}`, {
				method,
				headers: { Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(this.#timeoutMs),
			})
		} catch (err) {
			throw new C2CError(`console unreachable: ${(err as Error).message}`, 0)
		}
		if (res.status === 401) throw new C2CError('authentication failed — check the API key', 401)
		let payload: { success?: boolean; data?: T; error?: string | null }
		try {
			payload = (await res.json()) as typeof payload
		} catch {
			throw new C2CError(`unexpected response (HTTP ${res.status})`, res.status)
		}
		if (!res.ok || !payload.success) throw new C2CError(payload.error ?? `HTTP ${res.status}`, res.status)
		return payload.data as T
	}

	status = async (): Promise<ConsoleStatus> => this.#call('GET', '/api/status')
	setShoot = async (shoot: string): Promise<{ shoot: string }> => this.#call('POST', '/api/shoot', { shoot })
	setClip = async (input: string, clip: string): Promise<{ clip: string }> =>
		this.#call('POST', `/api/inputs/${encodeURIComponent(input)}/clip`, { clip })
	setNextTake = async (input: string, next: number): Promise<{ nextTake: number }> =>
		this.#call('POST', `/api/inputs/${encodeURIComponent(input)}/take`, { next })
	start = async (input: string, clip?: string): Promise<unknown> =>
		this.#call('POST', `/api/inputs/${encodeURIComponent(input)}/record/start`, clip ? { clip } : {})
	stop = async (input: string): Promise<unknown> =>
		this.#call('POST', `/api/inputs/${encodeURIComponent(input)}/record/stop`, {})
	toggle = async (input: string, clip?: string): Promise<unknown> =>
		this.#call('POST', `/api/inputs/${encodeURIComponent(input)}/record/toggle`, clip ? { clip } : {})
	startAll = async (): Promise<AllResult[]> => this.#call('POST', '/api/record/start-all', {})
	stopAll = async (): Promise<AllResult[]> => this.#call('POST', '/api/record/stop-all', {})
}
