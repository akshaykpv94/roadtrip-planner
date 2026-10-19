import type { Candidate } from '../providers/types.ts';

/** Detour = (origin→place + place→end) − direct slice. Never negative. */
export function detourFromSummary(leg1: { km: number; sec: number }, leg2: { km: number; sec: number }, sliceKm: number, sliceSec: number) {
  return { km: Math.max(0, leg1.km + leg2.km - sliceKm), min: Math.max(0, Math.round((leg1.sec + leg2.sec - sliceSec) / 60)) };
}

/** true/false if opening periods are known, undefined if unknown. Times in IST. Google day: 0=Sunday. */
export function isOpenAt(periods: Candidate['openPeriods'], at: Date): boolean | undefined {
  if (!periods || periods.length === 0) return undefined;
  const ist = new Date(at.getTime() + 5.5 * 3600_000);
  const mins = ist.getUTCDay() * 1440 + ist.getUTCHours() * 60 + ist.getUTCMinutes();
  for (const p of periods) {
    if (!p.close) return true; // open 24h
    const o = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    let c = p.close.day * 1440 + p.close.hour * 60 + p.close.minute;
    if (c <= o) c += 7 * 1440;
    if ((mins >= o && mins < c) || (mins + 7 * 1440 >= o && mins + 7 * 1440 < c)) return true;
  }
  return false;
}

export interface RankOpts { maxDetourMin: number; arriveAt: Date }

/** Higher is better. Returns null when a place should be excluded (known closed or too far off-route). */
export function score(c: Candidate, o: RankOpts): number | null {
  if (c.detourMin != null && c.detourMin > o.maxDetourMin) return null;
  if (isOpenAt(c.openPeriods, o.arriveAt) === false) return null;
  const rating = c.rating != null ? c.rating / 5 : 0.5;                      // unknown rating is neutral, never invented
  const volume = c.reviews != null ? Math.min(Math.log10(c.reviews + 1) / 4, 1) : 0;
  const detour = c.detourMin != null ? c.detourMin / o.maxDetourMin : 0.5;
  return rating * 0.5 + volume * 0.2 - detour * 0.5;
}

export function rank(cs: Candidate[], o: RankOpts): Candidate[] {
  return cs.map(c => ({ c, s: score(c, o) })).filter((x): x is { c: Candidate; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s).map(x => x.c);
}
