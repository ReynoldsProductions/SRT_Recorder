// Loads and validates runtime configuration from environment variables.
// Fails fast with a clear message: a misconfigured console must not start.

const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

export class ConfigError extends Error {}

// INPUTS (optional, seed only): "cam1:8897,cam2:8898" — used to create the inputs file on
// first run. After that, inputs are managed in the console UI / API.
export function parseInputs(raw) {
  if (!raw || !raw.trim()) return Object.freeze([]);
  const inputs = raw.split(',').map((part) => {
    const [name, port] = part.trim().split(':');
    if (!NAME_RE.test(name ?? '')) throw new ConfigError(`invalid input name: "${name}"`);
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      throw new ConfigError(`invalid port for input "${name}": "${port}"`);
    }
    return Object.freeze({ name, port: portNum });
  });
  const names = new Set(inputs.map((i) => i.name));
  if (names.size !== inputs.length) throw new ConfigError('duplicate input names in INPUTS');
  return Object.freeze(inputs);
}

function required(env, key) {
  const value = env[key];
  if (!value) throw new ConfigError(`${key} is required`);
  return value;
}

export function loadConfig(env = process.env) {
  const password = required(env, 'CONSOLE_PASSWORD');
  if (password.length < 12) throw new ConfigError('CONSOLE_PASSWORD must be at least 12 characters');
  if (env.API_KEY && env.API_KEY.length < 24) throw new ConfigError('API_KEY must be at least 24 characters');
  // Read-only credential for the DMZ relay's config sync. Its own secret: it can read every camera
  // passphrase, so it must not be reusable as (or derivable from) the API key or console password.
  if (env.SYNC_TOKEN && env.SYNC_TOKEN.length < 32) throw new ConfigError('SYNC_TOKEN must be at least 32 characters');
  if (env.SYNC_TOKEN && env.SYNC_TOKEN === env.API_KEY) throw new ConfigError('SYNC_TOKEN must differ from API_KEY');
  if (env.SYNC_TOKEN && env.SYNC_TOKEN === password) throw new ConfigError('SYNC_TOKEN must differ from CONSOLE_PASSWORD');
  const port = Number(env.PORT ?? 3020);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError('PORT must be an integer 1-65535');
  const relayPortMin = Number(env.RELAY_PORT_MIN || 8897);
  const relayPortMax = Number(env.RELAY_PORT_MAX || 8912);
  const validPort = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;
  if (!validPort(relayPortMin) || !validPort(relayPortMax) || relayPortMin > relayPortMax) {
    throw new ConfigError('RELAY_PORT_MIN/RELAY_PORT_MAX must be ports 1-65535 with MIN <= MAX');
  }
  return Object.freeze({
    port,
    consoleUser: env.CONSOLE_USER || 'engineer',
    consolePassword: password,
    omeApiUrl: required(env, 'OME_API_URL').replace(/\/+$/, ''),
    omeAccessToken: required(env, 'OME_ACCESS_TOKEN'),
    omeVhost: env.OME_VHOST || 'default',
    omeApp: env.OME_APP || 'app',
    recordingsDir: env.RECORDINGS_DIR || '/recordings',
    stateFile: env.STATE_FILE || '/data/state.json',
    omePreviewUrl: (env.OME_PREVIEW_URL || '').replace(/\/+$/, '') || null,
    seedInputs: parseInputs(env.INPUTS),
    seedPassphrases: Object.freeze(Object.fromEntries(
      Object.entries(env).filter(([k]) => k.startsWith('SEED_PASSPHRASE_')).map(([k, v]) => [k.slice(16).toLowerCase(), v]),
    )),
    inputsFile: env.INPUTS_FILE || '/data/inputs.json',
    relayPortMin,
    relayPortMax,
    relayStatusUrl: (env.RELAY_STATUS_URL || '').replace(/\/+$/, '') || null,
    publicHost: env.PUBLIC_HOST || '',
    recordingsShare: env.RECORDINGS_SHARE || '',
    apiKey: env.API_KEY || null,
    syncToken: env.SYNC_TOKEN || null,
    // Optional allowlist of client addresses the sync token may be used from (the relay host).
    syncAllowedIps: Object.freeze((env.SYNC_ALLOWED_IPS || '').split(',').map((a) => a.trim()).filter(Boolean)),
    // Set to 1 only when the console sits behind your own reverse proxy (see docs/OPERATIONS.md).
    trustProxy: ['1', 'true'].includes(String(env.TRUST_PROXY ?? '').toLowerCase()),
    staleAfterMs: Number(env.STALE_AFTER_MS ?? 5000),
  });
}
