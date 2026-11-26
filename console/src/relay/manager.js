// Relay manager: keeps one supervised SRT relay per enabled input in the shared inputs file,
// reconciling on change. Exposes status over HTTP for the console (ai-network only).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { parseInputsFile } from '../inputs-config.js';
import { createSupervisor } from './supervisor.js';
import { createHttpInputsSource } from './sync-source.js';

export function createManager({ readInputs, target, makeSupervisor = createSupervisor, log = console }) {
  const running = new Map(); // name -> { sig, sup }
  let lastError = null;

  async function reconcile() {
    let inputs;
    try {
      inputs = await readInputs();
      lastError = null;
    } catch (err) {
      // Keep current relays running on a bad/missing file rather than dropping live cameras.
      if (lastError !== err.message) log.error(`[manager] cannot read inputs: ${err.message}`);
      lastError = err.message;
      return;
    }
    const wanted = new Map(inputs.filter((i) => i.enabled).map((i) => [i.name, i]));
    for (const [name, { sig, sup }] of running) {
      const next = wanted.get(name);
      if (!next || JSON.stringify(next) !== sig) {
        log.info(`[manager] stopping ${name}${next ? ' (config changed)' : ''}`);
        sup.stop();
        running.delete(name);
      }
    }
    for (const [name, input] of wanted) {
      if (running.has(name)) continue;
      log.info(`[manager] starting ${name} on udp/${input.port}`);
      const sup = makeSupervisor({ input, target, log });
      sup.start();
      running.set(name, { sig: JSON.stringify(input), sup });
    }
  }

  return Object.freeze({
    reconcile,
    status: () => ({ error: lastError, inputs: [...running.values()].map(({ sup }) => sup.status()) }),
    stopAll: () => [...running.values()].forEach(({ sup }) => sup.stop()),
  });
}

/* c8 ignore start — process entry point, exercised by the container */
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.env.INPUTS_FILE || '/data/inputs.json';
  const range = { portMin: Number(process.env.RELAY_PORT_MIN || 8897), portMax: Number(process.env.RELAY_PORT_MAX || 8912) };
  const target = {
    omeHost: process.env.OME_SRT_HOST || 'ovenmediaengine',
    omePort: Number(process.env.OME_SRT_PORT || 9999),
    app: process.env.OME_APP || 'app',
    passphrase: process.env.OME_SRT_PASSPHRASE || undefined,
  };
  // Same host as the console: read the shared inputs file. DMZ host: set SYNC_URL (+ SYNC_TOKEN) and the
  // list is pulled from the console's read-only sync endpoint instead; the relay never has a local copy.
  const readInputs = process.env.SYNC_URL
    ? createHttpInputsSource({
      url: process.env.SYNC_URL,
      token: process.env.SYNC_TOKEN,
      range,
      allowInsecureHttp: process.env.SYNC_ALLOW_INSECURE_HTTP === '1',
      timeoutMs: Number(process.env.SYNC_TIMEOUT_MS || 5000),
    })
    : async () => parseInputsFile(await readFile(file, 'utf8'), range);
  const manager = createManager({ readInputs, target });
  await manager.reconcile();
  setInterval(manager.reconcile, Number(process.env.RECONCILE_MS || 2000));
  const port = Number(process.env.STATUS_PORT || 8090);
  createServer((req, res) => {
    const body = req.url === '/status' ? manager.status() : req.url === '/healthz' ? { status: 'ok' } : null;
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body ?? { error: 'not found' }));
  }).listen(port, () => console.info(`[manager] ${process.env.SYNC_URL ? `syncing from ${new URL(process.env.SYNC_URL).origin}` : `watching ${file}`}, status on :${port}, ports ${range.portMin}-${range.portMax}`));
  const shutdown = () => {
    manager.stopAll();
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
/* c8 ignore stop */
