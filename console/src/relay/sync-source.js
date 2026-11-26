// Input source for the relay when it runs on a different host from the console: instead of reading a
// shared inputs.json, poll the console's read-only sync endpoint (GET /api/relay/inputs) with the
// sync token. The console stays the single source of truth; the relay never holds a writable copy.
//
// Every failure throws. The manager treats a throw as "keep what's running", so a console blip can't
// drop live cameras, and a relay that has never synced simply has nothing enabled (listeners default off).

import { parseInputsFile } from '../inputs-config.js';

export function createHttpInputsSource({ url, token, range, fetchImpl = fetch, timeoutMs = 5000, allowInsecureHttp = false }) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new Error('SYNC_URL is not a valid URL');
  }
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('SYNC_URL must be an http(s) URL');
  if (target.protocol === 'http:' && !allowInsecureHttp) {
    throw new Error('SYNC_URL must be https: the response carries camera passphrases. Set SYNC_ALLOW_INSECURE_HTTP=1 only for a link you trust');
  }
  if (!token || token.length < 32) throw new Error('sync token (SYNC_TOKEN) must be at least 32 characters');

  const scrub = (text) => String(text).split(token).join('<token>');

  return async function readInputs() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(target.href, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: controller.signal,
        });
      } catch (err) {
        throw new Error(controller.signal.aborted ? `sync timed out after ${timeoutMs} ms` : `sync request failed: ${scrub(err.message)}`);
      }
      if (!res.ok) throw new Error(`sync rejected: HTTP ${res.status}`);
      let body;
      try {
        body = await res.json();
      } catch {
        throw new Error('sync response is not JSON');
      }
      const list = body?.data?.inputs;
      if (!Array.isArray(list)) throw new Error('sync response has no inputs list');
      // Re-validate on this side: the relay must not trust the wire (names/ports end up in ffmpeg args).
      return parseInputsFile(JSON.stringify({ inputs: list }), range);
    } finally {
      clearTimeout(timer);
    }
  };
}
