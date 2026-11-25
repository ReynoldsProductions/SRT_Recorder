// Authentication: HTTP Basic for people (browser), Bearer API key for machines (Companion).

import { timingSafeEqual, createHash } from 'node:crypto';

const digest = (s) => createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => timingSafeEqual(digest(a), digest(b));

export function checkBasicAuth(header, user, password) {
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  // Evaluate both comparisons to avoid leaking which part failed.
  const userOk = safeEqual(decoded.slice(0, idx), user);
  const passOk = safeEqual(decoded.slice(idx + 1), password);
  return userOk && passOk;
}

export function checkBearer(header, apiKey) {
  if (!apiKey || !header?.startsWith('Bearer ')) return false;
  return safeEqual(header.slice(7).trim(), apiKey);
}

// Returns 'bearer' | 'basic' | null.
export function authenticate(headers, config) {
  const header = headers.authorization;
  if (checkBearer(header, config.apiKey)) return 'bearer';
  if (checkBasicAuth(header, config.consoleUser, config.consolePassword)) return 'basic';
  return null;
}
