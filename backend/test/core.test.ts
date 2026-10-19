import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, encode, haversineKm, cumulativeKm } from '../src/lib/polyline.ts';
import { fuelRequiredLitres, usableRangeKm, fuelStopTargets } from '../src/lib/fuel.ts';
import { calcBudget } from '../src/lib/budget.ts';
import { detourFromSummary, isOpenAt, rank } from '../src/lib/ranking.ts';
import { daysNeeded, planTrip, refreshEta, type TripRequest } from '../src/planner.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { GoogleProvider } from '../src/providers/google.ts';
import { ProviderError, type MapsProvider, type RouteResult } from '../src/providers/types.ts';

const base: TripRequest = { from: 'Pune', to: 'Manjeri, Kerala', departure: new Date('2026-11-02T00:30:00Z'), days: 2, travellers: 2,
  fuelType: 'diesel', mileageKmpl: 15, tankLitres: 45, startFuelPct: 100, maxDrivingHours: 9, preferredDeparture: '07:00', food: 'none',
  hotelPerNight: 3000, foodPerPersonDay: 800, fuelPriceInr: 95, sightseeing: true, style: 'balanced', avoidTolls: false, bufferPct: 10 };

test('polyline encode/decode round-trips', () => {
  const pts = [{ lat: 18.52043, lng: 73.85674 }, { lat: 12.97159, lng: 77.59456 }];
  assert.deepEqual(decode(encode(pts)), pts);
});
test('haversine Pune-Bengaluru is roughly 735 km straight line', () => {
  const d = haversineKm({ lat: 18.5204, lng: 73.8567 }, { lat: 12.9716, lng: 77.5946 });
  assert.ok(d > 690 && d < 780, String(d));
});
test('fuel required includes buffer', () => assert.equal(fuelRequiredLitres(300, 15, 10), 22));
test('usable range keeps 25% reserve', () => assert.equal(usableRangeKm(40, 15), 450));
test('fuel stops: none needed for a short trip, several for a long one', () => {
  assert.deepEqual(fuelStopTargets(200, 450), []);
  const stops = fuelStopTargets(1000, 450);
  assert.ok(stops.length >= 2); assert.ok(stops.every((s, i) => i === 0 || s - stops[i - 1] < 450));
});
test('low starting fuel brings the first stop forward', () => assert.ok(fuelStopTargets(1000, 450, 0.3)[0] < 120));
test('budget formulas and toll basis', () => {
  const b = calcBudget({ distanceKm: 300, mileageKmpl: 15, fuelPriceInr: 100, bufferPct: 0, nights: 1, hotelPerNight: 2000, days: 2, travellers: 2, foodPerPersonDay: 500 });
  assert.equal(b.lines.fuel.amountInr, 2000); assert.equal(b.lines.stay.amountInr, 2000); assert.equal(b.lines.food.amountInr, 2000);
  assert.equal(b.lines.toll.basis, 'unknown'); assert.equal(b.totalInr, 6000);
});
test('detour is never negative', () => {
  assert.deepEqual(detourFromSummary({ km: 5, sec: 300 }, { km: 5, sec: 300 }, 12, 900), { km: 0, min: 0 });
  assert.deepEqual(detourFromSummary({ km: 8, sec: 600 }, { km: 8, sec: 600 }, 10, 600), { km: 6, min: 10 });
});
test('opening hours: known closed excluded, unknown kept, no invented data', () => {
  const periods = [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }];
  const monNoonIST = new Date('2026-11-02T06:30:00Z'), monNightIST = new Date('2026-11-02T18:00:00Z');
  assert.equal(isOpenAt(periods, monNoonIST), true); assert.equal(isOpenAt(periods, monNightIST), false); assert.equal(isOpenAt(undefined, monNoonIST), undefined);
  const r = rank([{ id: 'a', name: 'closed', lat: 0, lng: 0, openPeriods: periods, detourMin: 2 }, { id: 'b', name: 'unknown', lat: 0, lng: 0, detourMin: 2 }], { maxDetourMin: 10, arriveAt: monNightIST });
  assert.deepEqual(r.map(x => x.id), ['b']); assert.equal(r[0].rating, undefined);
});
test('ranking prefers small detour over slightly higher rating', () => {
  const r = rank([{ id: 'far', name: 'far', lat: 0, lng: 0, rating: 4.8, reviews: 5000, detourMin: 11 }, { id: 'near', name: 'near', lat: 0, lng: 0, rating: 4.3, reviews: 3000, detourMin: 1 }], { maxDetourMin: 12, arriveAt: new Date() });
  assert.equal(r[0].id, 'near');
});
test('days needed respects max driving hours', () => {
  assert.deepEqual(daysNeeded(18 * 3600, 9, 1), { days: 2, needed: 2, requestedTooShort: true });
  assert.equal(daysNeeded(8 * 3600, 9, 3).days, 3);
});

test('Pune to Manjeri (mock provider): multi-day, fuel, food, hotel, ordered ETAs', async () => {
  const trip = await planTrip(base, new MockProvider());
  assert.equal(trip.source, 'mock'); assert.ok(trip.warnings.some(w => w.startsWith('MOCK DATA')));
  assert.ok(trip.days.length >= 2);
  const kinds = trip.days.flatMap(d => d.stops.map(s => s.kind));
  for (const k of ['fuel', 'food', 'hotel']) assert.ok(kinds.includes(k as any), `missing ${k}`);
  assert.ok(trip.days.slice(0, -1).every(d => d.stops.at(-1)?.kind === 'hotel'));
  assert.ok(!trip.days.at(-1)!.stops.some(s => s.kind === 'hotel'));
  for (const d of trip.days) { assert.ok(d.driveMin <= base.maxDrivingHours * 60 + 5); const e = d.stops.map(s => s.eta); assert.deepEqual([...e].sort(), e); }
  assert.ok(Math.abs(trip.days.reduce((a, d) => a + d.distanceKm, 0) - trip.totalKm) <= trip.days.length);
});
test('too few days is raised, not hidden', async () => {
  const trip = await planTrip({ ...base, days: 1 }, new MockProvider());
  assert.ok(trip.warnings.some(w => w.includes('needs at least')));
});
test('fastest style skips optional tea and breakfast stops', async () => {
  const bal = await planTrip(base, new MockProvider()), fast = await planTrip({ ...base, style: 'fastest', sightseeing: false }, new MockProvider());
  const n = (t: typeof bal) => t.days.flatMap(d => d.stops).filter(s => s.kind === 'food' || s.kind === 'rest').length;
  assert.ok(n(fast) < n(bal));
});
test('places failure becomes a warning, trip still returns', async () => {
  const p = new MockProvider(); p.searchAlong = async () => { throw new ProviderError('boom'); };
  const trip = await planTrip(base, p);
  assert.ok(trip.warnings.some(w => w.includes('Could not load'))); assert.ok(trip.days.every(d => d.stops.length === 0));
});
test('route failure propagates (no fake itinerary)', async () => {
  const p: MapsProvider = { source: 'google', route: async () => { throw new ProviderError('down'); }, searchAlong: async () => [] };
  await assert.rejects(planTrip(base, p), /down/);
});

test('google provider: HTTP 500 becomes ProviderError', async () => {
  const orig = globalThis.fetch; globalThis.fetch = (async () => new Response('x', { status: 500 })) as typeof fetch;
  try { await assert.rejects(new GoogleProvider('k').route({ origin: 'a', destination: 'b', departure: new Date(), avoidTolls: false, alternatives: false }), ProviderError); }
  finally { globalThis.fetch = orig; }
});
test('google provider: daily cap blocks extra calls', async () => {
  const orig = globalThis.fetch; globalThis.fetch = (async () => new Response(JSON.stringify({ routes: [] }), { status: 200 })) as typeof fetch;
  const g = new GoogleProvider('k', 1); const req = { origin: 'a', destination: 'b', departure: new Date(), avoidTolls: false, alternatives: false };
  try { await assert.rejects(g.route(req), /No route/); await assert.rejects(g.route(req), /limit/); } finally { globalThis.fetch = orig; }
});
test('google provider: parses route + toll + traffic durations', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ routes: [{ distanceMeters: 100000, duration: '7200s', staticDuration: '6000s',
    polyline: { encodedPolyline: encode([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]) }, travelAdvisory: { tollInfo: { estimatedPrice: [{ currencyCode: 'INR', units: '250' }] } } }] }), { status: 200 })) as typeof fetch;
  try { const [r] = await new GoogleProvider('k').route({ origin: 'a', destination: 'b', departure: new Date(), avoidTolls: false, alternatives: false });
    assert.equal(r.distanceKm, 100); assert.equal(r.durationSec, 7200); assert.equal(r.staticDurationSec, 6000); assert.equal(r.tollInr, 250); }
  finally { globalThis.fetch = orig; }
});

test('refresh flags significant delay and better alternatives only when meaningful', async () => {
  const mk = (min: number, label: string): RouteResult => ({ distanceKm: 100, durationSec: min * 60, staticDurationSec: min * 60, polyline: '', trafficAware: true, label });
  const p: MapsProvider = { source: 'google', route: async () => [mk(700, 'main'), mk(640, 'alt-faster'), mk(695, 'alt-same')], searchAlong: async () => [] };
  const r = await refreshEta({ from: 'a', to: 'b', originalDurationMin: 600, departure: new Date(), avoidTolls: false }, p);
  assert.equal(r.deltaMin, 100); assert.equal(r.significantDelay, true); assert.deepEqual(r.betterAlternatives.map(a => a.label), ['alt-faster']);
  assert.match(r.note, /not a report/);
});
void cumulativeKm;
