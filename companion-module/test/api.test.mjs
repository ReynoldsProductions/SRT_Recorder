import { test } from 'node:test'
import assert from 'node:assert/strict'
import { C2CClient, C2CError } from '../dist/api.js'

function client(handler) {
	const calls = []
	const fetchImpl = async (url, init) => {
		calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined })
		return handler(url, init)
	}
	return { c: new C2CClient({ host: '10.0.0.5', port: 3020, apiKey: 'k'.repeat(32), fetchImpl }), calls }
}
const ok = (data) => new Response(JSON.stringify({ success: true, data, error: null }), { status: 200 })

test('sends bearer key and unwraps the envelope', async () => {
	const { c, calls } = client(() => ok({ shoot: 's', inputs: [] }))
	assert.deepEqual(await c.status(), { shoot: 's', inputs: [] })
	assert.equal(calls[0].url, 'http://10.0.0.5:3020/api/status')
	assert.equal(calls[0].init.headers.Authorization, `Bearer ${'k'.repeat(32)}`)
})

test('action endpoints and bodies', async () => {
	const { c, calls } = client(() => ok({}))
	await c.start('cam1', 'interview')
	await c.start('cam1')
	await c.toggle('cam 2')
	await c.setNextTake('cam1', 4)
	await c.setShoot('Day1')
	await c.startAll()
	await c.stopAll()
	assert.deepEqual(
		calls.map((x) => [x.url.replace('http://10.0.0.5:3020', ''), x.body]),
		[
			['/api/inputs/cam1/record/start', { clip: 'interview' }],
			['/api/inputs/cam1/record/start', {}],
			['/api/inputs/cam%202/record/toggle', {}],
			['/api/inputs/cam1/take', { next: 4 }],
			['/api/shoot', { shoot: 'Day1' }],
			['/api/record/start-all', {}],
			['/api/record/stop-all', {}],
		],
	)
})

test('maps errors: 401, API error message, unreachable, non-JSON', async () => {
	await assert.rejects(
		client(() => new Response('no', { status: 401 })).c.status(),
		(e) => e instanceof C2CError && e.status === 401 && /API key/.test(e.message),
	)
	await assert.rejects(
		client(
			() =>
				new Response(JSON.stringify({ success: false, data: null, error: 'cam1 is already recording' }), {
					status: 409,
				}),
		).c.start('cam1'),
		(e) => e.status === 409 && e.message === 'cam1 is already recording',
	)
	await assert.rejects(
		client(() => {
			throw new TypeError('fetch failed')
		}).c.status(),
		(e) => e.status === 0 && /unreachable/.test(e.message),
	)
	await assert.rejects(client(() => new Response('<html>', { status: 200 })).c.status(), /unexpected response/)
})
