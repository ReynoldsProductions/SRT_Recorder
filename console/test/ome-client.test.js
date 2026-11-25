import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOmeClient, OmeError } from '../src/ome-client.js';

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, ...opts, body: opts.body ? JSON.parse(opts.body) : undefined });
    const { status = 200, body } = handler(url, opts);
    return { ok: status < 400, status, json: async () => body };
  };
  return { impl, calls };
}

test('sends basic auth and unwraps response', async () => {
  const f = fakeFetch(() => ({ body: { statusCode: 200, response: ['cam1'] } }));
  const c = createOmeClient({ baseUrl: 'http://ome:8081', accessToken: 'tok', fetchImpl: f.impl });
  assert.deepEqual(await c.listStreams(), ['cam1']);
  assert.equal(f.calls[0].url, 'http://ome:8081/v1/vhosts/default/apps/app/streams');
  assert.equal(f.calls[0].headers.Authorization, `Basic ${Buffer.from('tok').toString('base64')}`);
});

test('getStream returns null on 404, throws on other errors', async () => {
  const f404 = fakeFetch(() => ({ status: 404, body: { statusCode: 404, message: 'Could not find the stream' } }));
  assert.equal(await createOmeClient({ baseUrl: 'x', accessToken: 't', fetchImpl: f404.impl }).getStream('cam9'), null);
  const f500 = fakeFetch(() => ({ status: 500, body: { statusCode: 500, message: 'boom' } }));
  await assert.rejects(createOmeClient({ baseUrl: 'x', accessToken: 't', fetchImpl: f500.impl }).getStream('cam1'), (e) => e instanceof OmeError && e.status === 500);
});

test('record calls use the documented action endpoints and bodies', async () => {
  const f = fakeFetch(() => ({ body: { statusCode: 200, response: { id: 'r1', state: 'recording' } } }));
  const c = createOmeClient({ baseUrl: 'http://ome', accessToken: 't', fetchImpl: f.impl });
  await c.startRecord('cam1', 'r1');
  await c.stopRecord('r1');
  await c.listRecords();
  assert.equal(f.calls[0].url, 'http://ome/v1/vhosts/default/apps/app:startRecord');
  assert.deepEqual(f.calls[0].body, { id: 'r1', stream: { name: 'cam1' } });
  assert.equal(f.calls[1].url, 'http://ome/v1/vhosts/default/apps/app:stopRecord');
  assert.deepEqual(f.calls[1].body, { id: 'r1' });
  assert.equal(f.calls[2].url, 'http://ome/v1/vhosts/default/apps/app:records');
});

test('network failure and non-JSON map to 502 OmeError', async () => {
  const down = createOmeClient({ baseUrl: 'x', accessToken: 't', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(down.listStreams(), (e) => e.status === 502 && /unreachable/.test(e.message));
  const html = createOmeClient({ baseUrl: 'x', accessToken: 't', fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }) });
  await assert.rejects(html.listStreams(), (e) => e.status === 502 && /non-JSON/.test(e.message));
});
