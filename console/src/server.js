// Entry point: wires config, stores, OME client and services into the HTTP app.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, ConfigError } from './config.js';
import { createOmeClient } from './ome-client.js';
import { listRecordings } from './recordings.js';
import { createApp } from './app.js';
import { createStateStore } from './state.js';
import { createInputsStore, generatePassphrase } from './inputs-config.js';
import { createRecordingService } from './recording.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`[config] ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const ome = createOmeClient({ baseUrl: config.omeApiUrl, accessToken: config.omeAccessToken, vhost: config.omeVhost, app: config.omeApp });

const state = createStateStore(config.stateFile);
await state.load();

// First run only: seed the registry from INPUTS (+ SEED_PASSPHRASE_<NAME> to keep an existing camera working).
const seed = config.seedInputs.map((i) => ({ ...i, passphrase: config.seedPassphrases[i.name] || generatePassphrase() }));
const inputs = createInputsStore(config.inputsFile, { portMin: config.relayPortMin, portMax: config.relayPortMax, seed });
await inputs.load();

async function relayStatus() {
  if (!config.relayStatusUrl) return [];
  const res = await fetch(`${config.relayStatusUrl}/status`, { signal: AbortSignal.timeout(1500) });
  return (await res.json()).inputs ?? [];
}

const recording = createRecordingService({ config, ome, state, inputs, relayStatus });
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const handler = createApp({ config, recording, inputs, state, publicDir, listRecordings: () => listRecordings(config.recordingsDir) });

createServer(handler).listen(config.port, () => {
  console.info(`[c2c-console] listening on :${config.port} — inputs: ${inputs.list().map((i) => `${i.name}:${i.port}`).join(', ') || 'none'} — shoot: ${state.get().shoot} — preview: ${config.omePreviewUrl ? 'on' : 'off'} — api key: ${config.apiKey ? 'on' : 'off'}`);
});
