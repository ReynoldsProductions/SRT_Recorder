// Thin client for the OvenMediaEngine REST API (v1). fetch is injectable for tests.

export class OmeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createOmeClient({ baseUrl, accessToken, vhost = 'default', app = 'app', fetchImpl = fetch, timeoutMs = 5000 }) {
  const auth = `Basic ${Buffer.from(accessToken).toString('base64')}`;
  const appPath = `/v1/vhosts/${encodeURIComponent(vhost)}/apps/${encodeURIComponent(app)}`;
  const statsPath = `/v1/stats/current/vhosts/${encodeURIComponent(vhost)}/apps/${encodeURIComponent(app)}`;

  async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new OmeError(`OME unreachable: ${err.message}`, 502);
    }
    let payload;
    try {
      payload = await res.json();
    } catch {
      throw new OmeError(`OME returned non-JSON (HTTP ${res.status})`, 502);
    }
    if (!res.ok || (payload.statusCode && payload.statusCode >= 400)) {
      throw new OmeError(payload.message || `OME HTTP ${res.status}`, payload.statusCode || res.status);
    }
    return payload.response;
  }

  // Returns null when OME doesn't know the stream (no signal) instead of throwing.
  async function orNullOn404(promise) {
    try {
      return await promise;
    } catch (err) {
      if (err instanceof OmeError && err.status === 404) return null;
      throw err;
    }
  }

  const stream = (name) => `/streams/${encodeURIComponent(name)}`;

  return Object.freeze({
    listStreams: () => call('GET', `${appPath}/streams`),
    getStream: (name) => orNullOn404(call('GET', `${appPath}${stream(name)}`)),
    getStreamStats: (name) => orNullOn404(call('GET', `${statsPath}${stream(name)}`)),
    listRecords: () => call('POST', `${appPath}:records`, {}),
    startRecord: (name, id, extra = {}) => call('POST', `${appPath}:startRecord`, { ...extra, id, stream: { name } }),
    stopRecord: (id) => call('POST', `${appPath}:stopRecord`, { id }),
  });
}
