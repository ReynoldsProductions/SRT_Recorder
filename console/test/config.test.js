import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInputs, loadConfig, ConfigError } from '../src/config.js';

const baseEnv = { CONSOLE_PASSWORD: 'a-long-password', OME_API_URL: 'http://ome:8081/', OME_ACCESS_TOKEN: 't', INPUTS: 'cam1:8897' };

test('parseInputs parses name:port pairs', () => {
  assert.deepEqual(parseInputs('cam1:8897, cam2:8898'), [{ name: 'cam1', port: 8897 }, { name: 'cam2', port: 8898 }]);
});

test('parseInputs: empty is allowed (seed only); rejects bad names, ports, duplicates', () => {
  assert.deepEqual(parseInputs(''), []);
  assert.throws(() => parseInputs('cam 1:8897'), ConfigError);
  assert.throws(() => parseInputs('cam1:99999'), ConfigError);
  assert.throws(() => parseInputs('cam1'), ConfigError);
  assert.throws(() => parseInputs('cam1:8897,cam1:8898'), ConfigError);
});

test('loadConfig applies defaults and strips trailing slash', () => {
  const c = loadConfig(baseEnv);
  assert.equal(c.port, 3020);
  assert.equal(c.consoleUser, 'engineer');
  assert.equal(c.omeApiUrl, 'http://ome:8081');
  assert.equal(c.recordingsDir, '/recordings');
});

test('loadConfig fails fast on missing or weak secrets', () => {
  assert.throws(() => loadConfig({ ...baseEnv, CONSOLE_PASSWORD: '' }), /CONSOLE_PASSWORD is required/);
  assert.throws(() => loadConfig({ ...baseEnv, CONSOLE_PASSWORD: 'short' }), /at least 12/);
  assert.throws(() => loadConfig({ ...baseEnv, OME_ACCESS_TOKEN: undefined }), /OME_ACCESS_TOKEN/);
  assert.throws(() => loadConfig({ ...baseEnv, PORT: 'abc' }), /PORT/);
  assert.throws(() => loadConfig({ ...baseEnv, API_KEY: 'short' }), /API_KEY/);
});

test('loadConfig: seed passphrases, relay range, api key', () => {
  const c = loadConfig({ ...baseEnv, SEED_PASSPHRASE_CAM1: 'x'.repeat(24), API_KEY: 'k'.repeat(24), RELAY_PORT_MAX: '8900' });
  assert.equal(c.seedPassphrases.cam1, 'x'.repeat(24));
  assert.equal(c.relayPortMax, 8900);
  assert.equal(c.apiKey, 'k'.repeat(24));
  assert.equal(loadConfig(baseEnv).apiKey, null);
});
