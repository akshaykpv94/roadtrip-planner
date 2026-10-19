// Small building blocks for being a polite client of shared public services (Nominatim, OSRM demo, Overpass).

export interface Clock { now(): number; sleep(ms: number): Promise<void> }
export const realClock: Clock = { now: () => Date.now(), sleep: ms => new Promise(r => setTimeout(r, ms)) };

/**
 * Runs tasks strictly one at a time, with at least `gapMs` between the START of one task and the START of the next.
 * One Throttle per upstream service gives a global (not per-request) rate limit.
 */
export class Throttle {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = Number.NEGATIVE_INFINITY;
  constructor(private gapMs: number, private clock: Clock = realClock) {}
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const wait = this.lastStart + this.gapMs - this.clock.now();
      if (wait > 0) await this.clock.sleep(wait);
      this.lastStart = this.clock.now();
      return task();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Time-limited cache with a size cap (oldest entry is dropped first). Only successful results should be stored. */
export class TtlCache<V> {
  private m = new Map<string, { v: V; exp: number }>();
  constructor(private ttlMs: number, private max = 500, private clock: Clock = realClock) {}
  get(key: string): V | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (e.exp <= this.clock.now()) { this.m.delete(key); return undefined; }
    return e.v;
  }
  set(key: string, v: V) {
    this.m.delete(key);
    if (this.m.size >= this.max) { const oldest = this.m.keys().next().value; if (oldest !== undefined) this.m.delete(oldest); }
    this.m.set(key, { v, exp: this.clock.now() + this.ttlMs });
  }
  get size() { return this.m.size; }
}

/** Shares one running request between identical callers, so duplicate taps never become duplicate upstream calls. */
export class InFlight<V> {
  private m = new Map<string, Promise<V>>();
  run(key: string, fn: () => Promise<V>): Promise<V> {
    const existing = this.m.get(key);
    if (existing) return existing;
    const p = fn().finally(() => this.m.delete(key));
    this.m.set(key, p);
    return p;
  }
}

/** Cache first, then share any identical request already running, then call `fn` and cache a success. */
export async function cachedOnce<V>(cache: TtlCache<V>, inflight: InFlight<V>, key: string, fn: () => Promise<V>): Promise<V> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  return inflight.run(key, async () => { const v = await fn(); cache.set(key, v); return v; });
}

/** Retry-After header: seconds or an HTTP date. Returns milliseconds, or undefined if absent or unreadable. */
export function parseRetryAfter(h: string | null | undefined, now = Date.now()): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(0, t - now) : undefined;
}
