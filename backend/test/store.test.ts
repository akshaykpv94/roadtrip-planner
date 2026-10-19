import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepo, hydrate, toStorable } from '../src/tripStore.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { encode } from '../src/lib/polyline.ts';
import type { MapsProvider } from '../src/providers/types.ts';

const live = { source: 'live', title: 'A to B', totalKm: 100, drivingMin: 120, warnings: [], polyline: [{ lat: 1, lng: 1 }],
  req: { from: 'A', to: 'B', departure: '2026-11-02T06:00:00+05:30', avoidTolls: false },
  days: [{ n: 1, stops: [{ id: 'p1', kind: 'food', name: 'Secret Dhaba', address: 'x', lat: 1, lng: 2, rating: 4.5, reviews: 10, phone: '1', mapsUri: 'u', eta: '09:00', stayMin: 30, status: 'visited', detourMin: 3, alternatives: [{ id: 'z', name: 'Alt' }] }] }] };

test('live trips are stored without Google place content, keeping the user\'s own state', () => {
  const s = toStorable(live); const st = s.days[0].stops[0];
  assert.deepEqual(Object.keys(st).sort(), ['detourKm', 'detourMin', 'eta', 'id', 'kind', 'status', 'stayMin']);
  assert.equal(st.status, 'visited'); assert.deepEqual(s.polyline, []); assert.ok(!JSON.stringify(s).includes('Secret Dhaba'));
});
test('mock trips are stored whole', () => assert.equal(toStorable({ ...live, source: 'mock' }).days[0].stops[0].name, 'Secret Dhaba'));

const gp = (details: MapsProvider['details']): MapsProvider => ({ source: 'google',
  route: async () => [{ distanceKm: 1, durationSec: 60, staticDurationSec: 60, polyline: encode([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]), trafficAware: true }],
  searchAlong: async () => [], details });

test('hydrate refetches place details and route line', async () => {
  const repo = new MemoryRepo('u1'); const row = await repo.create({ title: 't', source: 'live', request: live.req, itinerary: toStorable(live) });
  const t = await hydrate(row, gp(async ids => ({ p1: { id: 'p1', name: 'Fresh Name', lat: 5, lng: 6, rating: 4.1 } })));
  const s = t.days[0].stops[0];
  assert.equal(s.name, 'Fresh Name'); assert.equal(s.status, 'visited'); assert.equal(t.polyline.length, 2); assert.equal(t.savedId, row.id);
});
test('hydrate marks missing places unavailable and warns, never invents details', async () => {
  const row = await new MemoryRepo('u1').create({ title: 't', source: 'live', request: live.req, itinerary: toStorable(live) });
  const t = await hydrate(row, gp(async () => ({})));
  const s = t.days[0].stops[0]; assert.equal(s.unavailable, true); assert.equal(s.rating, undefined); assert.ok(t.warnings.some((w: string) => w.includes('could not be loaded')));
});
test('hydrate survives a route failure', async () => {
  const row = await new MemoryRepo('u1').create({ title: 't', source: 'live', request: live.req, itinerary: toStorable(live) });
  const p = gp(async () => ({})); p.route = async () => { throw new Error('x'); };
  const t = await hydrate(row, p); assert.deepEqual(t.polyline, []); assert.ok(t.warnings.some((w: string) => w.includes('route line')));
});
test('mock provider returns stored mock trips unchanged', async () => {
  const row = await new MemoryRepo('u1').create({ title: 't', source: 'mock', request: live.req, itinerary: toStorable({ ...live, source: 'mock' }) });
  assert.equal((await hydrate(row, new MockProvider())).days[0].stops[0].name, 'Secret Dhaba');
});
test('users cannot read, change or delete each other\'s trips', async () => {
  const a = new MemoryRepo('A'), b = a.forUser('B');
  const row = await a.create({ title: 'mine', source: 'live', request: live.req, itinerary: {} });
  assert.equal(await b.get(row.id), null); assert.equal(await b.update(row.id, { title: 'x', itinerary: {} }), null);
  assert.equal(await b.remove(row.id), false); assert.equal((await b.list()).length, 0); assert.equal((await a.list()).length, 1);
});
