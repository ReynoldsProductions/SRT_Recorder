// Supervises one input's ffmpeg relay: camera (SRT caller, AES) -> listener port -> OME, stream copy.
// Restarts after every session so the camera can reconnect. spawn is injectable for tests.

import { spawn as nodeSpawn } from 'node:child_process';

export const redact = (line) => line.replace(/passphrase=[^&'"\s]*/g, 'passphrase=<redacted>');

export function buildFfmpegArgs(input, { omeHost, omePort, app }) {
  const streamId = encodeURIComponent(`srt://${omeHost}:${omePort}/${app}/${input.name}`);
  return [
    '-hide_banner', '-nostats', '-loglevel', 'info',
    // Short probe + real-time pacing: avoids bursting the probe buffer into the server.
    '-analyzeduration', '2000000', '-probesize', '5000000', '-re',
    '-i', `srt://0.0.0.0:${input.port}?mode=listener&latency=${input.latencyMs * 1000}&passphrase=${input.passphrase}`,
    '-map', '0', '-c', 'copy', '-f', 'mpegts',
    `srt://${omeHost}:${omePort}?streamid=${streamId}&latency=200000`,
  ];
}

export function createSupervisor({ input, target, spawnImpl = nodeSpawn, log = console, restartDelayMs = 1000, clock = () => new Date() }) {
  let child = null;
  let stopped = false;
  let timer = null;
  let status = { state: 'waiting', since: clock().toISOString(), sessions: 0, lastError: null, connectedFrom: null };
  const tag = `[relay ${input.name}:${input.port}]`;
  const setStatus = (changes) => {
    status = { ...status, ...changes };
  };

  function onLine(line) {
    if (!line.trim()) return;
    if (/^Input #0/.test(line)) setStatus({ state: 'connected', since: clock().toISOString(), lastError: null });
    if (/error|failed|rejected/i.test(line) && !/Error during demuxing/.test(line)) setStatus({ lastError: redact(line).slice(0, 200) });
    log.info(`${tag} ${redact(line)}`);
  }

  function run() {
    if (stopped) return;
    setStatus({ state: 'waiting', since: clock().toISOString() });
    child = spawnImpl('ffmpeg', buildFfmpegArgs(input, target), { stdio: ['ignore', 'ignore', 'pipe'] });
    let buf = '';
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop();
      lines.forEach(onLine);
    });
    child.on('error', (err) => setStatus({ lastError: `spawn failed: ${err.message}` }));
    child.on('exit', (code) => {
      child = null;
      const wasConnected = status.state === 'connected';
      setStatus({ sessions: status.sessions + (wasConnected ? 1 : 0), state: stopped ? 'stopped' : 'waiting', since: clock().toISOString() });
      log.info(`${tag} session ended (code ${code})`);
      if (!stopped) timer = setTimeout(run, restartDelayMs);
    });
  }

  return Object.freeze({
    start() {
      stopped = false;
      run();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      if (child) child.kill('SIGTERM');
      setStatus({ state: 'stopped', since: clock().toISOString() });
    },
    status: () => ({ name: input.name, port: input.port, ...status }),
  });
}
