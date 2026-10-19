import test from 'node:test';
import assert from 'node:assert/strict';
import { OsmProvider, MAX_CANDIDATES, buildOverpassQuery, mapOverpassElements, parseLatLng, parseOsrmRoute } from '../src/providers/osm.ts';
import { ProviderError } from '../src/providers/types.ts';
import { decode, encode, type LatLng } from '../src/lib/polyline.ts';
import { distToPolylineKm } from '../src/lib/geo.ts';
import { Throttle, TtlCache, parseRetryAfter } from '../src/lib/httpGuard.ts';
import { planTrip, refreshEta, type TripRequest } from '../src/planner.ts';

// ---- test doubles: no test here touches the network ----
function fakeClock() { let t = 1_000_000; return { now: () => t, sleep: async (ms: number) => { t += ms; } }; }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
interface Call { url: string; host: string; method: string; at: number; ua?: string; body?: string; contentType?: string }
function fakeFetch(clk: ReturnType<typeof fakeClock>, handler: (c: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    const c: Call = { url, host: new URL(url).host, method: init?.method ?? 'GET', at: clk.now(), ua: h['User-Agent'], contentType: h['Content-Type'], body: init?.body as string | undefined };
    calls.push(c);
    return handler(c, calls.length);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const mk = (clk: ReturnType<typeof fakeClock>, f: typeof fetch, extra: ConstructorParameters<typeof OsmProvider>[0] = {}) =>
  new OsmProvider({ fetch: f, clock: clk, log: () => {}, userAgent: 'test-agent', ...extra });
const PUNE = { lat: 18.52043, lng: 73.85674 }, BLR = { lat: 12.97159, lng: 77.59456 };
const nominatim = (p: LatLng) => json([{ lat: String(p.lat), lon: String(p.lng), display_name: 'x' }]);
const OSRM_OK = { code: 'Ok', waypoints: [], routes: [{ distance: 123456.7, duration: 7890.1,
  geometry: { type: 'LineString', coordinates: [[73.8567, 18.5204], [74.2433, 16.705], [77.5946, 12.9716]] } }] };
const line = (a: LatLng, b: LatLng, n: number) => Array.from({ length: n + 1 }, (_, i) => ({ lat: a.lat + ((b.lat - a.lat) * i) / n, lng: a.lng + ((b.lng - a.lng) * i) / n }));
const req = { origin: 'Pune', destination: 'Bengaluru', departure: new Date(), avoidTolls: false, alternatives: true };
const SLICE = line({ lat: 13, lng: 77 }, { lat: 13, lng: 77.3 }, 30); // about 32 km east-west
const search = { kind: 'fuel' as const, slicePolyline: encode(SLICE), origin: SLICE[0], sliceKm: 32, sliceSec: 2000 };

// ---------------- geocoding (Nominatim) ----------------
test('geocode: Nominatim result becomes coordinates; request identifies the app and is India-scoped', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, () => nominatim({ lat: 18.5204303, lng: 73.8567437 }));
  assert.deepEqual(await mk(clk, f).geocode('Pune'), { lat: 18.5204303, lng: 73.8567437 });
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.equal(u.searchParams.get('q'), 'Pune'); assert.equal(u.searchParams.get('format'), 'jsonv2');
  assert.equal(u.searchParams.get('limit'), '1'); assert.equal(u.searchParams.get('countrycodes'), 'in');
  assert.equal(calls[0].ua, 'test-agent');
});
test('geocode: not found is a clear 404, not a guess', async () => {
  const clk = fakeClock(); const { f } = fakeFetch(clk, () => json([]));
  await assert.rejects(mk(clk, f).geocode('Nowhereville'), (e: any) => e instanceof ProviderError && e.status === 404 && /Could not find "Nowhereville"/.test(e.message));
});
test('geocode: explicit latitude,longitude needs no network; out-of-range pairs are not treated as coordinates', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, () => json([]));
  const p = mk(clk, f);
  assert.deepEqual(await p.geocode(' 12.9716 , 77.5946 '), { lat: 12.9716, lng: 77.5946 });
  assert.deepEqual(await p.geocode({ lat: 1, lng: 2 }), { lat: 1, lng: 2 });
  assert.equal(calls.length, 0);
  assert.equal(parseLatLng('95, 200'), null); assert.equal(parseLatLng('Pune, 411001'), null); assert.deepEqual(parseLatLng('-33.8,151.2'), { lat: -33.8, lng: 151.2 });
});
test('geocode: unreadable or invalid responses become ProviderError', async () => {
  const clk = fakeClock();
  await assert.rejects(mk(clk, fakeFetch(clk, () => json({ nope: 1 })).f).geocode('abc'), /unreadable/);
  await assert.rejects(mk(clk, fakeFetch(clk, () => json([{ lat: 'x', lon: '1' }])).f).geocode('abd'), /invalid location/);
  await assert.rejects(mk(clk, fakeFetch(clk, () => new Response('<html>', { status: 200 })).f).geocode('abe'), /unreadable/);
});
test('geocode: network errors are retried with backoff, then reported (not hidden)', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, () => { throw new TypeError('fetch failed'); });
  await assert.rejects(mk(clk, f).geocode('Pune'), (e: any) => e instanceof ProviderError && e.status === 502 && /unreachable/.test(e.message));
  assert.equal(calls.length, 3);                                   // 1 try + 2 retries
  assert.ok(calls[1].at - calls[0].at >= 1000 && calls[2].at - calls[1].at >= 2000, 'exponential backoff');
});
test('geocode: a request that hangs is aborted at the timeout', async () => {
  const clk = fakeClock();
  const hang = (async (_u: string, init?: RequestInit) => new Promise((_res, rej) => init!.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
  await assert.rejects(mk(clk, hang, { timeoutMs: { nominatim: 20 }, retries: { nominatim: 0 } }).geocode('Pune'), (e: any) => e.status === 504 && /timed out/.test(e.message));
});

// ---------------- rate limiting, caching, de-duplication, HTTP 429/5xx ----------------
test('rate limit: geocoding requests are sequential and at least 1 second apart, globally', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, () => nominatim(PUNE));
  const p = mk(clk, f);
  await Promise.all(['Aaa town', 'Bbb town', 'Ccc town', 'Ddd town'].map(q => p.geocode(q)));
  assert.equal(calls.length, 4);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].at - calls[i - 1].at >= 1000, `gap ${calls[i].at - calls[i - 1].at}ms`);
});
test('Throttle never overlaps tasks and spaces their starts', async () => {
  const clk = fakeClock(); const th = new Throttle(500, clk); const starts: number[] = []; let running = 0, maxRunning = 0;
  await Promise.all([1, 2, 3].map(() => th.run(async () => { running++; maxRunning = Math.max(maxRunning, running); starts.push(clk.now()); await Promise.resolve(); running--; })));
  assert.equal(maxRunning, 1); assert.ok(starts[1] - starts[0] >= 500 && starts[2] - starts[1] >= 500);
});
test('cache: repeated and re-spelled geocodes hit Nominatim once; entries expire', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, () => nominatim(PUNE));
  const p = mk(clk, f, { geocodeTtlMs: 60_000 });
  await p.geocode('Pune'); await p.geocode('  pune '); await p.geocode('PUNE');
  assert.equal(calls.length, 1);
  await clk.sleep(61_000); await p.geocode('Pune');
  assert.equal(calls.length, 2);
});
test('in-flight de-duplication: simultaneous identical lookups share one request', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, () => nominatim(PUNE));
  const p = mk(clk, f);
  const out = await Promise.all([p.geocode('Mysuru'), p.geocode('mysuru'), p.geocode('Mysuru ')]);
  assert.equal(calls.length, 1); assert.deepEqual(out[0], out[2]);
});
test('failures are not cached: the next call tries again', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, () => json([]));
  const p = mk(clk, f);
  await assert.rejects(p.geocode('Typo'), /Could not find/); await assert.rejects(p.geocode('Typo'), /Could not find/);
  assert.equal(calls.length, 2);
});
test('HTTP 429 honours a short Retry-After, then succeeds', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, (_c, n) => (n === 1 ? new Response('slow down', { status: 429, headers: { 'Retry-After': '3' } }) : nominatim(PUNE)));
  assert.deepEqual(await mk(clk, f).geocode('Pune'), PUNE);
  assert.equal(calls.length, 2); assert.ok(calls[1].at - calls[0].at >= 3000);
});
test('HTTP 429 with a long Retry-After is reported at once instead of hammering the service', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, () => new Response('', { status: 429, headers: { 'Retry-After': '600' } }));
  await assert.rejects(mk(clk, f).geocode('Pune'), (e: any) => e.status === 429 && /limiting requests/.test(e.message));
  assert.equal(calls.length, 1);
});
test('HTTP 5xx: retried with backoff; persistent failure is a 502; 4xx is not retried', async () => {
  let clk = fakeClock(); let r = fakeFetch(clk, (_c, n) => (n === 1 ? new Response('', { status: 503 }) : nominatim(PUNE)));
  assert.deepEqual(await mk(clk, r.f).geocode('Pune'), PUNE); assert.equal(r.calls.length, 2);
  clk = fakeClock(); r = fakeFetch(clk, () => new Response('', { status: 500 }));
  await assert.rejects(mk(clk, r.f).geocode('Pune'), (e: any) => e.status === 502 && /HTTP 500/.test(e.message)); assert.equal(r.calls.length, 3);
  clk = fakeClock(); r = fakeFetch(clk, () => new Response('blocked', { status: 403 }));
  await assert.rejects(mk(clk, r.f).geocode('Pune'), /HTTP 403/); assert.equal(r.calls.length, 1);
});
test('TtlCache and parseRetryAfter basics', () => {
  const clk = fakeClock(); const c = new TtlCache<number>(100, 2, clk);
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  assert.equal(c.get('a'), undefined); assert.equal(c.get('c'), 3); assert.equal(c.size, 2);   // size cap drops the oldest
  assert.equal(parseRetryAfter('5'), 5000); assert.equal(parseRetryAfter(null), undefined); assert.equal(parseRetryAfter('garbage'), undefined);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4000), 6000);
});

// ---------------- routing (OSRM) ----------------
test('OSRM parsing: real distance/duration, GeoJSON [lng,lat] converted and polyline-encoded, no traffic, tolls unknown', () => {
  const r = parseOsrmRoute(OSRM_OK);
  assert.ok(Math.abs(r.distanceKm - 123.4567) < 1e-9); assert.equal(r.durationSec, 7890.1); assert.equal(r.staticDurationSec, 7890.1);
  assert.equal(r.trafficAware, false); assert.equal(r.tollInr, undefined);
  assert.deepEqual(decode(r.polyline), [{ lat: 18.5204, lng: 73.8567 }, { lat: 16.705, lng: 74.2433 }, { lat: 12.9716, lng: 77.5946 }]);
});
test('OSRM parsing: errors are explicit', () => {
  assert.throws(() => parseOsrmRoute({ code: 'NoRoute' }), (e: any) => e.status === 404 && /No drivable route/.test(e.message));
  assert.throws(() => parseOsrmRoute({ code: 'NoSegment' }), (e: any) => e.status === 404 && /drivable road/.test(e.message));
  assert.throws(() => parseOsrmRoute({ code: 'Ok', routes: [] }), (e: any) => e.status === 404);
  assert.throws(() => parseOsrmRoute({ code: 'TooBig' }), (e: any) => e.status === 400);
  assert.throws(() => parseOsrmRoute(null), ProviderError);
  assert.throws(() => parseOsrmRoute({ code: 'Ok', routes: [{ distance: -1, duration: 1, geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] } }] }), /invalid route/);
  assert.throws(() => parseOsrmRoute({ code: 'Ok', routes: [{ distance: 1, duration: 1, geometry: { type: 'LineString', coordinates: [[1, 1], ['x', 2]] } }] }), /invalid route/);
  assert.throws(() => parseOsrmRoute({ code: 'Ok', routes: [{ distance: 1, duration: 1, geometry: { type: 'LineString', coordinates: [[1, 1], [2, 99]] } }] }), /invalid route/);
});
function routeWorld(clk: ReturnType<typeof fakeClock>) {
  return fakeFetch(clk, c => c.host === 'router.project-osrm.org' ? json(OSRM_OK)
    : nominatim(new URL(c.url).searchParams.get('q')!.toLowerCase().startsWith('pune') ? PUNE : BLR));
}
test('route: geocodes both ends once, calls OSRM with lng,lat order, single route, no invented alternatives or tolls', async () => {
  const clk = fakeClock(); const { f, calls } = routeWorld(clk);
  const routes = await mk(clk, f).route(req);          // req.alternatives is true, but OSM must not invent any
  assert.equal(routes.length, 1);
  const [r] = routes;
  assert.equal(r.trafficAware, false); assert.equal(r.tollInr, undefined); assert.ok(Math.abs(r.distanceKm - 123.4567) < 1e-9);
  assert.ok(r.notes!.some(n => /free-flow/.test(n)) && r.notes!.some(n => /Live traffic/.test(n)));
  const osrm = calls.filter(c => c.host === 'router.project-osrm.org'); assert.equal(osrm.length, 1);
  assert.match(osrm[0].url, /^https:\/\/router\.project-osrm\.org\/route\/v1\/driving\/73\.85674,18\.52043;77\.59456,12\.97159\?/);
  const u = new URL(osrm[0].url); assert.equal(u.searchParams.get('alternatives'), 'false'); assert.equal(u.searchParams.get('geometries'), 'geojson'); assert.equal(u.searchParams.get('overview'), 'full');
  assert.equal(calls.filter(c => c.host === 'nominatim.openstreetmap.org').length, 2);
});
test('route: cached and de-duplicated, including simultaneous identical requests; departure time does not matter', async () => {
  const clk = fakeClock(); const { f, calls } = routeWorld(clk); const p = mk(clk, f);
  await Promise.all([p.route(req), p.route({ ...req, departure: new Date(0) })]);
  await p.route(req);
  assert.equal(calls.filter(c => c.host === 'router.project-osrm.org').length, 1);
  assert.equal(calls.filter(c => c.host === 'nominatim.openstreetmap.org').length, 2);
});
test('route: OSRM requests are spaced at least a second apart', async () => {
  const clk = fakeClock(); const { f, calls } = routeWorld(clk); const p = mk(clk, f);
  await p.route(req); await p.route({ ...req, destination: '12.9,77.5' });
  const osrm = calls.filter(c => c.host === 'router.project-osrm.org'); assert.equal(osrm.length, 2); assert.ok(osrm[1].at - osrm[0].at >= 1000);
});
test('route: avoid-tolls is not faked; the route says it may include tolls', async () => {
  const clk = fakeClock(); const { f, calls } = routeWorld(clk);
  const [r] = await mk(clk, f).route({ ...req, avoidTolls: true });
  assert.ok(r.notes!.some(n => /Toll avoidance could not be applied/.test(n))); assert.equal(r.tollInr, undefined);
  assert.ok(!calls.some(c => c.url.includes('exclude')));
  const clk2 = fakeClock(); const w2 = routeWorld(clk2);   // a self-hosted OSRM that does support exclude=toll
  const [r2] = await mk(clk2, w2.f, { osrmExcludeToll: true }).route({ ...req, avoidTolls: true });
  assert.ok(w2.calls.some(c => c.url.includes('exclude=toll'))); assert.ok(!r2.notes!.some(n => /Toll avoidance/.test(n)));
});
test('route: no route is reported clearly and not cached', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, c => (c.host === 'router.project-osrm.org' ? json({ code: 'NoRoute', message: 'x' }, 400) : nominatim(PUNE)));
  const p = mk(clk, f);
  await assert.rejects(p.route(req), (e: any) => e instanceof ProviderError && e.status === 404 && /No drivable route/.test(e.message));
  await assert.rejects(p.route(req), /No drivable route/);
  assert.equal(calls.filter(c => c.host === 'router.project-osrm.org').length, 2);
});
test('route: an OSRM outage (5xx) is retried then reported as unavailable', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, c => (c.host === 'router.project-osrm.org' ? new Response('', { status: 502 }) : nominatim(PUNE)));
  await assert.rejects(mk(clk, f).route(req), (e: any) => e.status === 502 && /temporarily unavailable/.test(e.message));
  assert.equal(calls.filter(c => c.host === 'router.project-osrm.org').length, 3);
});

// ---------------- places (Overpass) ----------------
test('Overpass query: fixed tag filters, bounded corridor, limited output', () => {
  const pts = SLICE.slice(0, 3);
  const q = buildOverpassQuery('fuel', pts);
  assert.match(q, /nwr\(around:2500,13\.0000,77\.0000,/); assert.match(q, /\["amenity"="fuel"\]/); assert.match(q, /out center tags 200;/); assert.match(q, /\[timeout:25\]/);
  assert.match(buildOverpassQuery('fuel', pts, { electric: true }), /charging_station/); assert.doesNotMatch(buildOverpassQuery('fuel', pts, { electric: true }), /"fuel"/);
  assert.match(buildOverpassQuery('food', pts), /restaurant\|cafe\|fast_food\|food_court/); assert.match(buildOverpassQuery('food', pts, { vegOnly: true }), /diet:vegetarian"!="no"/);
  assert.match(buildOverpassQuery('hotel', pts), /hotel\|motel\|guest_house\|hostel/);
  assert.match(buildOverpassQuery('sight', pts), /attraction\|museum\|viewpoint/);
  const rest = buildOverpassQuery('rest', pts); assert.match(rest, /rest_area\|services/); assert.match(rest, /"amenity"="cafe"/); assert.equal(rest.match(/nwr\(/g)!.length, 2);
  assert.ok(buildOverpassQuery('fuel', pts).length < 2000, 'a bounded query stays small');
});
const EL = [
  { type: 'node', id: 1, lat: 13.001, lon: 77.1, tags: { amenity: 'fuel', name: 'HP Petrol Pump', phone: '+91 80 1234', opening_hours: '24/7', 'addr:street': 'NH 48', 'addr:city': 'Tumakuru', 'addr:postcode': '572101' } },
  { type: 'way', id: 2, center: { lat: 13.0, lon: 77.15 }, tags: { amenity: 'fuel', brand: 'Indian Oil' } },
  { type: 'node', id: 3, lat: 13.0012, lon: 77.1005, tags: { amenity: 'fuel', name: 'HP  Petrol Pump!' } },   // same place, mapped twice
  { type: 'node', id: 4, lat: 13.01, lon: 77.2, tags: { amenity: 'fuel' } },
  { type: 'node', id: 5, tags: { amenity: 'fuel', name: 'No coordinates' } },
  { type: 'bogus', id: 6, lat: 13, lon: 77 }, null, { type: 'node', id: 7.5, lat: 13, lon: 77 },
];
test('Overpass mapping: only real OSM data, de-duplicated, nearest first, with OSM URL', () => {
  const out = mapOverpassElements(EL, 'fuel', SLICE);
  assert.deepEqual(out.map(c => c.id), ['osm-way-2', 'osm-node-1', 'osm-node-4']);
  const [way, node, unnamed] = out;
  assert.equal(way.name, 'Indian Oil'); assert.equal(way.lat, 13.0); assert.equal(way.lng, 77.15); assert.equal(way.mapsUri, 'https://www.openstreetmap.org/way/2');
  assert.equal(node.name, 'HP Petrol Pump'); assert.equal(node.phone, '+91 80 1234'); assert.equal(node.openingHours, '24/7'); assert.equal(node.address, 'NH 48, Tumakuru, 572101');
  assert.equal(node.mapsUri, 'https://www.openstreetmap.org/node/1');
  assert.equal(unnamed.name, 'Unnamed petrol pump'); assert.equal(unnamed.phone, undefined); assert.equal(unnamed.openingHours, undefined); assert.equal(unnamed.address, undefined);
  for (const c of out) { assert.equal(c.rating, undefined); assert.equal(c.reviews, undefined); assert.equal(c.openPeriods, undefined); }
  assert.ok(way.detourKm! < 0.1 && node.detourKm! < 0.5 && unnamed.detourKm! > 1.5, 'approximate distance from the route');
  assert.ok(out[0].detourKm! <= out[1].detourKm! && out[1].detourKm! <= out[2].detourKm!);
});
test('Overpass mapping: result count is capped', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ type: 'node', id: 1000 + i, lat: 13 + i * 0.0004, lon: 77.1 + i * 0.001, tags: { amenity: 'fuel', name: `Pump ${i}` } }));
  assert.equal(mapOverpassElements(many, 'fuel', SLICE).length, MAX_CANDIDATES);
});
test('distance from route is straight-line distance to the polyline', () => {
  const d = distToPolylineKm({ lat: 13.01, lng: 77.1 }, SLICE); assert.ok(d > 1.08 && d < 1.14, String(d));
  assert.ok(distToPolylineKm({ lat: 13, lng: 77.1 }, SLICE) < 0.001);
  assert.ok(Math.abs(distToPolylineKm({ lat: 13, lng: 76.9 }, SLICE) - 10.84) < 0.1, 'beyond the end it measures to the end point (0.1 degree of longitude at 13N)');
});
const overpassOk = (elements: unknown[] = EL) => json({ version: 0.6, elements });
test('searchAlong: one bounded POST per slice, candidates mapped, repeated searches served from cache', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, () => overpassOk()); const p = mk(clk, f);
  const a = await p.searchAlong(search); const b = await p.searchAlong(search);
  assert.deepEqual(a.map(c => c.id), ['osm-way-2', 'osm-node-1', 'osm-node-4']); assert.deepEqual(a, b);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].url, 'https://overpass-api.de/api/interpreter'); assert.equal(calls[0].contentType, 'application/x-www-form-urlencoded');
  assert.match(decodeURIComponent(calls[0].body!), /^data=\[out:json\]\[timeout:25\][\s\S]*"amenity"="fuel"/);
  a[0].name = 'tampered'; assert.notEqual((await p.searchAlong(search))[0].name, 'tampered', 'callers cannot corrupt the cache');
});
test('searchAlong: different kinds are separate queries, spaced at least a second apart and never concurrent', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, () => overpassOk([])); const p = mk(clk, f);
  await Promise.all((['fuel', 'food', 'hotel'] as const).map(kind => p.searchAlong({ ...search, kind })));
  assert.equal(calls.length, 3); for (let i = 1; i < 3; i++) assert.ok(calls[i].at - calls[i - 1].at >= 1000);
});
test('searchAlong: simultaneous identical searches share one request', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, () => overpassOk()); const p = mk(clk, f);
  await Promise.all([p.searchAlong(search), p.searchAlong(search)]); assert.equal(calls.length, 1);
});
test('searchAlong: huge areas are refused before any request is sent', async () => {
  const clk = fakeClock(); const { f, calls } = fakeFetch(clk, () => overpassOk());
  const long = encode(line({ lat: 13, lng: 77 }, { lat: 13, lng: 79 }, 50)); // about 215 km
  await assert.rejects(mk(clk, f).searchAlong({ ...search, slicePolyline: long }), (e: any) => e instanceof ProviderError && e.status === 400 && /too large/.test(e.message));
  await assert.rejects(mk(clk, f).searchAlong({ ...search, slicePolyline: encode([SLICE[0]]) }), /empty/);
  assert.equal(calls.length, 0);
});
test('searchAlong: Overpass overload and timeouts surface as errors, are retried sensibly and are not cached', async () => {
  let clk = fakeClock(); let r = fakeFetch(clk, (_c, n) => (n === 1 ? new Response('', { status: 429 }) : overpassOk()));
  assert.equal((await mk(clk, r.f).searchAlong(search)).length, 3); assert.equal(r.calls.length, 2);              // 429: backoff then success
  clk = fakeClock(); r = fakeFetch(clk, () => new Response('', { status: 504 }));
  await assert.rejects(mk(clk, r.f).searchAlong(search), (e: any) => e.status === 502 && /Overpass/.test(e.message)); assert.equal(r.calls.length, 2); // 1 retry only
  clk = fakeClock(); r = fakeFetch(clk, () => json({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 26 seconds.' }));
  const p = mk(clk, r.f);
  await assert.rejects(p.searchAlong(search), (e: any) => e.status === 504); await assert.rejects(p.searchAlong(search), /ran out of time/);
  assert.equal(r.calls.length, 2);
  clk = fakeClock(); r = fakeFetch(clk, () => json({ nothing: true }));
  await assert.rejects(mk(clk, r.f).searchAlong(search), /unreadable/);
});

// ---------------- the planner on top of the OSM provider ----------------
const trip: TripRequest = { from: 'Pune', to: 'Bengaluru', departure: new Date('2026-11-02T00:30:00Z'), days: 2, travellers: 2, fuelType: 'diesel', mileageKmpl: 15,
  tankLitres: 45, startFuelPct: 100, maxDrivingHours: 9, preferredDeparture: '07:00', food: 'none', hotelPerNight: 3000, foodPerPersonDay: 800,
  fuelPriceInr: 95, sightseeing: true, style: 'balanced', avoidTolls: false, bufferPct: 10 };
function osmWorld(clk: ReturnType<typeof fakeClock>) {
  const geometry = line(PUNE, BLR, 200).map(p => [p.lng, p.lat]);
  return fakeFetch(clk, c => {
    if (c.host === 'nominatim.openstreetmap.org') return nominatim(new URL(c.url).searchParams.get('q')!.startsWith('Pune') ? PUNE : BLR);
    if (c.host === 'router.project-osrm.org') return json({ code: 'Ok', routes: [{ distance: 840_000, duration: 13 * 3600, geometry: { type: 'LineString', coordinates: geometry } }] });
    const q = decodeURIComponent(c.body!.slice(5)); const nums = /around:\d+,([^)]*)\)/.exec(q)![1].split(',').map(Number);
    const mid = Math.floor(nums.length / 4) * 2; const lat = nums[mid], lon = nums[mid + 1];   // a place exactly on the route, mid-slice
    const kind = q.includes('"fuel"') ? 'fuel' : q.includes('restaurant') ? 'food' : q.includes('hotel') ? 'hotel' : q.includes('rest_area') ? 'rest' : 'sight';
    return json({ elements: [{ type: 'node', id: Math.round(lat * 1e4) * 1000 + Math.round(lon * 1e3) % 1000, lat, lon, tags: { name: `OSM ${kind} ${lat.toFixed(2)}` } }] });
  });
}
test('planner + OSM: real route, OSM-labelled trip, honest about traffic and tolls, no ratings, bounded requests', async () => {
  const clk = fakeClock(); const { f, calls } = osmWorld(clk);
  const t = await planTrip(trip, mk(clk, f));
  assert.equal(t.source, 'osm'); assert.equal(t.totalKm, 840); assert.equal(t.drivingMin, 780); assert.equal(t.trafficAware, false);
  assert.ok(t.warnings.some(w => /OpenStreetMap data/.test(w) && /may not be available/.test(w)));
  assert.ok(t.warnings.some(w => /Traffic-aware timing is unavailable/.test(w)));
  assert.ok(t.warnings.some(w => /Toll prices are unknown/.test(w)));
  assert.ok(!t.warnings.some(w => /MOCK|Google/.test(w)));
  assert.equal(t.budget.lines.toll.basis, 'unknown'); assert.match(t.budget.lines.toll.note, /NOT included/);
  assert.equal(t.alternatives.length, 0);
  assert.ok(t.days.length >= 2);
  const stops = t.days.flatMap(d => d.stops); const kinds = new Set(stops.map(s => s.kind));
  for (const k of ['fuel', 'food', 'hotel']) assert.ok(kinds.has(k as any), `missing ${k}`);
  for (const s of stops) { assert.equal(s.rating, undefined); assert.equal(s.reviews, undefined); assert.match(s.mapsUri!, /^https:\/\/www\.openstreetmap\.org\/node\//); assert.match(s.id, /^osm-node-/); }
  assert.ok(t.days.slice(0, -1).every(d => d.stops.at(-1)?.kind === 'hotel'));
  for (const d of t.days) { const e = d.stops.map(s => s.eta); assert.deepEqual([...e].sort(), e); }
  // Politeness: Nominatim only for the two endpoints (not per stop); everything stays on the three public OSM services; Overpass is spaced out.
  assert.equal(calls.filter(c => c.host === 'nominatim.openstreetmap.org').length, 2);
  assert.equal(calls.filter(c => c.host === 'router.project-osrm.org').length, 1);
  assert.deepEqual([...new Set(calls.map(c => c.host))].sort(), ['nominatim.openstreetmap.org', 'overpass-api.de', 'router.project-osrm.org']);
  const op = calls.filter(c => c.host === 'overpass-api.de'); assert.ok(op.length >= 5 && op.length <= 30, `overpass calls: ${op.length}`);
  for (let i = 1; i < op.length; i++) assert.ok(op[i].at - op[i - 1].at >= 1000);
  for (const c of op) assert.ok(decodeURIComponent(c.body!).length < 4000, 'every query is small and bounded');
});
test('planner + OSM: a failed places lookup is a warning, never fake stops', async () => {
  const clk = fakeClock(); const w = osmWorld(clk);
  const f = (async (url: string, init?: RequestInit) => (new URL(url).host === 'overpass-api.de' ? new Response('', { status: 504 }) : w.f(url, init))) as typeof fetch;
  const t = await planTrip(trip, mk(clk, f));
  assert.ok(t.warnings.some(x => /Could not load/.test(x))); assert.ok(t.days.every(d => d.stops.length === 0));
});
test('refresh + OSM: no traffic, so it reports no change and says it cannot detect delays', async () => {
  const clk = fakeClock(); const { f } = osmWorld(clk);
  const r = await refreshEta({ from: 'Pune', to: 'Bengaluru', originalDurationMin: 780, departure: new Date(), avoidTolls: false }, mk(clk, f));
  assert.equal(r.trafficAware, false); assert.equal(r.deltaMin, 0); assert.equal(r.significantDelay, false); assert.deepEqual(r.betterAlternatives, []);
  assert.match(r.note, /cannot detect delays/);
});
