// Authenticated reverse proxy for OME's LL-HLS output, so the browser preview works
// without exposing OME's port and stays same-origin (CSP 'self').

import { Readable } from 'node:stream';

const FILE_RE = /^[A-Za-z0-9_.-]+\.(m3u8|m4s|mp4|aac|ts)$/;
// content-length is deliberately NOT forwarded: fetch transparently decompresses, so an
// upstream (gzip) length would truncate the decoded body. Node chunks the response instead.
const PASS_HEADERS = ['content-type', 'cache-control'];

export function parsePreviewPath(pathname, app) {
  const m = pathname.match(/^\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!m || m[1] !== app || !FILE_RE.test(m[3])) return null;
  return { input: decodeURIComponent(m[2]), file: m[3] };
}

export async function proxyPreview({ req, res, url, upstreamBase, fetchImpl = fetch, timeoutMs = 15000 }) {
  let upstream;
  try {
    upstream = await fetchImpl(`${upstreamBase}${url.pathname}${url.search}`, {
      headers: { 'Accept-Encoding': 'identity' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    return res.end(`preview upstream unavailable: ${err.name}`);
  }
  const headers = { 'X-Content-Type-Options': 'nosniff' };
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers[h] = v;
  }
  res.writeHead(upstream.status, headers);
  if (!upstream.body || req.method === 'HEAD') return res.end();
  Readable.fromWeb(upstream.body)
    .on('error', () => res.destroy())
    .pipe(res);
}
