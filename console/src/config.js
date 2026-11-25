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
  const port = Number(env.PORT ?? 3020);
  if (!Number.isInteger(port)) throw new ConfigError('PORT must be an integer');
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
    relayPortMin: Number(env.RELAY_PORT_MIN || 8897),
    relayPortMax: Number(env.RELAY_PORT_MAX || 8912),
    relayStatusUrl: (env.RELAY_STATUS_URL || '').replace(/\/+$/, '') || null,
    publicHost: env.PUBLIC_HOST || '',
    recordingsShare: env.RECORDINGS_SHARE || '',
    apiKey: env.API_KEY || null,
    staleAfterMs: Number(env.STALE_AFTER_MS ?? 5000),
  });
}
