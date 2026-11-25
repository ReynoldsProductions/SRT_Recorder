// Failed-login throttle: after `maxFails` bad credentials from one client within `windowMs`,
// that client is locked out for `lockMs`. In-memory only (resets on restart), which is enough to
// make online password guessing impractical on a LAN service. The clock is injectable for tests.

export function createThrottle({ maxFails = 8, windowMs = 10 * 60_000, lockMs = 5 * 60_000, maxKeys = 1000, clock = () => Date.now() } = {}) {
  const entries = new Map(); // key -> { fails: number[], lockedUntil: number }

  function prune(now) {
    for (const [key, e] of entries) {
      e.fails = e.fails.filter((t) => now - t < windowMs);
      if (!e.fails.length && e.lockedUntil <= now) entries.delete(key);
    }
  }

  // Seconds the client must wait before trying again; 0 when allowed.
  function retryAfter(key) {
    const e = entries.get(key);
    const now = clock();
    return e && e.lockedUntil > now ? Math.ceil((e.lockedUntil - now) / 1000) : 0;
  }

  // Records a failed attempt; returns true when this failure triggered a lockout.
  function fail(key) {
    const now = clock();
    if (entries.size >= maxKeys && !entries.has(key)) prune(now);
    // Still full of live entries: refuse to track more rather than grow without bound.
    if (entries.size >= maxKeys && !entries.has(key)) return false;
    const e = entries.get(key) ?? { fails: [], lockedUntil: 0 };
    e.fails = [...e.fails.filter((t) => now - t < windowMs), now];
    const locked = e.fails.length >= maxFails;
    if (locked) {
      e.lockedUntil = now + lockMs;
      e.fails = [];
    }
    entries.set(key, e);
    return locked;
  }

  const succeed = (key) => entries.delete(key);

  return Object.freeze({ retryAfter, fail, succeed, size: () => entries.size });
}
