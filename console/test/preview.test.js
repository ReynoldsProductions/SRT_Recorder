import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePreviewPath, proxyPreview } from '../src/preview.js';

test('parsePreviewPath accepts only app/input/file with media extensions', () => {
  assert.deepEqual(parsePreviewPath('/app/cam1/llhls.m3u8', 'app'), { input: 'cam1', file: 'llhls.m3u8' });
  assert.deepEqual(parsePreviewPath('/app/cam1/part_1_2_video_x_llhls.m4s', 'app'), { input: 'cam1', file: 'part_1_2_video_x_llhls.m4s' });
  assert.equal(parsePreviewPath('/other/cam1/llhls.m3u8', 'app'), null);
  assert.equal(parsePreviewPath('/app/cam1/../../etc/passwd', 'app'), null);
  assert.equal(parsePreviewPath('/app/cam1/index.html', 'app'), null);
  assert.equal(parsePreviewPath('/app/cam1', 'app'), null);
});

function fakeRes() {
  const r = { status: null, headers: null, body: '', ended: false };
  r.writeHead = (s, h) => { r.status = s; r.headers = h; };
  r.end = (b) => { if (b) r.body += b; r.ended = true; };
  r.write = (c) => { r.body += c; return true; };
  r.on = () => r; r.once = () => r; r.emit = () => true; r.removeListener = () => r;
  return r;
}

test('proxyPreview forwards path+query and whitelisted headers', async () => {
  let seen, seenOpts;
  const fetchImpl = async (u, opts) => {
    seen = u;
    seenOpts = opts;
    return new Response('#EXTM3U', { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl', 'set-cookie': 'x=1', 'content-length': '3' } });
  };
  const res = fakeRes();
  await proxyPreview({ req: { method: 'HEAD' }, res, url: new URL('http://h/app/cam1/llhls.m3u8?_HLS_msn=5'), upstreamBase: 'http://ome:3333', fetchImpl });
  assert.equal(seen, 'http://ome:3333/app/cam1/llhls.m3u8?_HLS_msn=5');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/vnd.apple.mpegurl');
  assert.equal(res.headers['set-cookie'], undefined);
  // Regression: forwarding a gzip content-length with a decoded body truncated playlists.
  assert.equal(res.headers['content-length'], undefined);
  assert.equal(seenOpts.headers['Accept-Encoding'], 'identity');
});

test('proxyPreview returns 502 when upstream is down', async () => {
  const res = fakeRes();
  await proxyPreview({ req: { method: 'GET' }, res, url: new URL('http://h/app/cam1/llhls.m3u8'), upstreamBase: 'http://ome:3333', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(res.status, 502);
});
