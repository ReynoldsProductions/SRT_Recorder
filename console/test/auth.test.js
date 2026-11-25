import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBasicAuth, checkBearer, authenticate } from '../src/auth.js';

const b64 = (s) => Buffer.from(s).toString('base64');
test('basic auth exact match only', () => {
  assert.equal(checkBasicAuth(`Basic ${b64('u:p')}`, 'u', 'p'), true);
  assert.equal(checkBasicAuth(`Basic ${b64('u:x')}`, 'u', 'p'), false);
  assert.equal(checkBasicAuth(`Basic ${b64('nocolon')}`, 'u', 'p'), false);
  assert.equal(checkBasicAuth(undefined, 'u', 'p'), false);
});
test('bearer requires a configured key', () => {
  assert.equal(checkBearer('Bearer abc', null), false);
  assert.equal(checkBearer('Bearer abc', 'abc'), true);
  assert.equal(checkBearer('Bearer abd', 'abc'), false);
  assert.equal(authenticate({ authorization: 'Bearer abc' }, { apiKey: 'abc' }), 'bearer');
  assert.equal(authenticate({ authorization: `Basic ${b64('u:p')}` }, { consoleUser: 'u', consolePassword: 'p' }), 'basic');
  assert.equal(authenticate({}, { apiKey: 'abc' }), null);
});
