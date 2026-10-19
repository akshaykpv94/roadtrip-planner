import type { Candidate, Kind, MapsProvider, RouteReq, RouteResult, SearchReq } from './types.ts';
import { ProviderError } from './types.ts';
import { cumulativeKm, decode, encode, haversineKm, type LatLng } from '../lib/polyline.ts';
import { distToPolylineKm, thinPolyline } from '../lib/geo.ts';
import { InFlight, Throttle, TtlCache, cachedOnce, parseRetryAfter, realClock, type Clock } from '../lib/httpGuard.ts';

/**
 * OpenStreetMap provider: Nominatim (geocoding) + OSRM (routing) + Overpass (places). No API key, no billing.
 *
 * These are shared public services run by volunteers. They are fine for development, personal use and modest traffic, and
 * they are NOT production infrastructure: they can throttle, block or go away. This class therefore throttles globally,
 * caches, de-duplicates identical in-flight requests, bounds every query, and backs off on 429/5xx. To go beyond personal
 * use, point NOMINATIM_URL / OSRM_URL / OVERPASS_URL at your own instances.
 *
 * What it does NOT have, and never pretends to have: live traffic, toll prices, ratings, reviews, verified opening hours.
 */

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const DEFAULT_USER_AGENT = 'HighwayPlanner/0.1 (personal project; https://github.com/akshaykpv94/roadtrip-planner)';

/** Largest route slice we will search around. Anything bigger is refused rather than turned into a large-area query. */
export const MAX_SLICE_KM = 120;
/** Most candidates returned from one search. The planner only needs the best few. */
export const MAX_CANDIDATES = 20;
/** Straight-line detour is converted to minutes at this speed (km/h). It is an approximation, not a routed detour. */
const DETOUR_KMH = 40;

export interface OsmOptions {
  userAgent?: string;
  nominatimUrl?: string; osrmUrl?: string; overpassUrl?: string;
  countryCodes?: string;
  /** Set true only if your OSRM server supports `exclude=toll` (the public demo server does not). */
  osrmExcludeToll?: boolean;
  fetch?: typeof fetch; clock?: Clock; log?: (entry: Record<string, unknown>) => void;
  nominatimGapMs?: number; osrmGapMs?: number; overpassGapMs?: number;
  timeoutMs?: { nominatim?: number; osrm?: number; overpass?: number };
  retries?: { nominatim?: number; osrm?: number; overpass?: number };
  backoffMs?: number; maxRetryAfterMs?: number;
  geocodeTtlMs?: number; routeTtlMs?: number; poiTtlMs?: number;
}

interface Service { name: string; throttle: Throttle; timeoutMs: number; retries: number }
type Attempt = { failure: 'timeout' | 'network' } | { status: number; body: any; text: string; retryAfterMs?: number };

// ---------- pure helpers (exported for tests) ----------

const COORD = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
/** "12.97, 77.59" -> coordinates, or null if the text is not an explicit, in-range latitude,longitude pair. */
export function parseLatLng(text: string): LatLng | null {
  const m = COORD.exec(text);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates an OSRM JSON body and converts it to the app's RouteResult (GeoJSON [lng,lat] -> encoded lat/lng polyline). */
export function parseOsrmRoute(json: any): RouteResult {
  if (!json || typeof json.code !== 'string') throw new ProviderError('Routing service returned an unreadable response.');
  if (json.code === 'NoRoute') throw new ProviderError('No drivable route was found between these places.', 404);
  if (json.code === 'NoSegment') throw new ProviderError('One of the places is not close enough to a drivable road.', 404);
  if (json.code === 'TooBig') throw new ProviderError('This route is too long for the routing service.', 400);
  if (json.code !== 'Ok') throw new ProviderError(`Routing service could not plan this route (${json.code}).`);
  const rt = Array.isArray(json.routes) ? json.routes[0] : undefined;
  if (!rt) throw new ProviderError('No drivable route was found between these places.', 404);
  const coords = rt.geometry?.type === 'LineString' ? rt.geometry.coordinates : undefined;
  if (!isNum(rt.distance) || !isNum(rt.duration) || rt.distance < 0 || rt.duration < 0 || !Array.isArray(coords) || coords.length < 2)
    throw new ProviderError('Routing service returned an invalid route.');
  const pts: LatLng[] = [];
  for (const c of coords) {
    if (!Array.isArray(c) || !isNum(c[0]) || !isNum(c[1]) || Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180)
      throw new ProviderError('Routing service returned an invalid route.');
    pts.push({ lat: c[1], lng: c[0] }); // GeoJSON order is [longitude, latitude]
  }
  return { distanceKm: rt.distance / 1000, durationSec: rt.duration, staticDurationSec: rt.duration, polyline: encode(pts),
    trafficAware: false, tollInr: undefined, label: 'OpenStreetMap / OSRM route' };
}

const FILTERS: Record<Kind, string[]> = {
  fuel: ['["amenity"="fuel"]'],
  food: ['["amenity"~"^(restaurant|cafe|fast_food|food_court)$"]'],
  hotel: ['["tourism"~"^(hotel|motel|guest_house|hostel)$"]'],
  rest: ['["highway"~"^(rest_area|services)$"]', '["amenity"="cafe"]'],
  sight: ['["tourism"~"^(attraction|museum|viewpoint)$"]'],
};
const EV_FILTERS = ['["amenity"="charging_station"]'];
/** Corridor half-width in metres. Chosen so a place at the edge is still inside the planner's maximum detour for its kind. */
const RADIUS_M: Record<Kind, number> = { fuel: 2500, food: 4000, hotel: 6000, rest: 2500, sight: 6000 };

/** Builds a bounded Overpass query: only fixed tag filters and numeric coordinates, never user text. */
export function buildOverpassQuery(kind: Kind, route: LatLng[], o: { vegOnly?: boolean; electric?: boolean } = {}): string {
  const filters = (o.electric && kind === 'fuel' ? EV_FILTERS : FILTERS[kind]).map(f => (o.vegOnly && kind === 'food' ? f + '["diet:vegetarian"!="no"]' : f));
  const around = `around:${RADIUS_M[kind]},${route.map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(',')}`;
  return `[out:json][timeout:25];\n(\n${filters.map(f => `  nwr(${around})${f};`).join('\n')}\n);\nout center tags 200;`;
}

const UNNAMED: Record<Kind, string> = { fuel: 'Unnamed petrol pump', food: 'Unnamed eatery', hotel: 'Unnamed lodging', rest: 'Unnamed rest stop', sight: 'Unnamed attraction' };
const cleanText = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const normName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function addressOf(t: Record<string, unknown>): string | undefined {
  const full = cleanText(t['addr:full'], 200);
  if (full) return full;
  const street = [cleanText(t['addr:housenumber'], 20), cleanText(t['addr:street'], 80)].filter(Boolean).join(' ') || undefined;
  const parts = [cleanText(t['addr:housename'], 60), street, cleanText(t['addr:suburb'], 60), cleanText(t['addr:city'] ?? t['addr:town'] ?? t['addr:village'] ?? t['addr:place'], 60),
    cleanText(t['addr:state'], 60), cleanText(t['addr:postcode'], 12)].filter((x): x is string => !!x);
  return parts.length ? [...new Set(parts)].join(', ') : undefined;
}

/**
 * Overpass elements -> candidates. Only data present in OSM is used: no ratings, review counts or opening status are
 * invented. Results are de-duplicated, ordered nearest-to-route first, and capped.
 */
export function mapOverpassElements(elements: any[], kind: Kind, route: LatLng[]): Candidate[] {
  const items: { c: Candidate; named: boolean; dist: number }[] = [];
  for (const e of elements) {
    if (!e || !['node', 'way', 'relation'].includes(e.type) || !Number.isInteger(e.id)) continue;
    const lat = isNum(e.lat) ? e.lat : e.center?.lat, lng = isNum(e.lon) ? e.lon : e.center?.lon;
    if (!isNum(lat) || !isNum(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const t: Record<string, unknown> = e.tags && typeof e.tags === 'object' ? e.tags : {};
    const real = cleanText(t.name, 120) ?? cleanText(t['name:en'], 120);
    const name = real ?? cleanText(t.brand, 120) ?? cleanText(t.operator, 120) ?? (kind === 'fuel' && t.amenity === 'charging_station' ? 'Unnamed charging station' : UNNAMED[kind]);
    const dist = distToPolylineKm({ lat, lng }, route), detourKm = Math.round(2 * dist * 10) / 10;
    items.push({ named: !!real, dist, c: {
      id: `osm-${e.type}-${e.id}`, name, address: addressOf(t), lat, lng,
      phone: cleanText(t.phone ?? t['contact:phone'], 40), openingHours: cleanText(t.opening_hours, 200),
      mapsUri: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      detourKm, detourMin: Math.round((detourKm / DETOUR_KMH) * 60) } });
  }
  items.sort((a, b) => a.dist - b.dist || a.c.id.localeCompare(b.c.id));
  const kept: typeof items = [];
  for (const it of items) {
    const dup = kept.some(k => { const d = haversineKm(k.c, it.c); return d < 0.03 || (k.named && it.named && d < 0.3 && normName(k.c.name) === normName(it.c.name)); });
    if (!dup) kept.push(it);
    if (kept.length >= MAX_CANDIDATES) break;
  }
  return kept.map(k => k.c);
}

// ---------- provider ----------

export class OsmProvider implements MapsProvider {
  source = 'osm' as const;
  private clock: Clock; private ua: string; private log: (e: Record<string, unknown>) => void;
  private svc: { nominatim: Service; osrm: Service; overpass: Service };
  private urls: { nominatim: string; osrm: string; overpass: string };
  private geoCache: TtlCache<LatLng>; private geoFlight = new InFlight<LatLng>();
  private routeCache: TtlCache<RouteResult>; private routeFlight = new InFlight<RouteResult>();
  private poiCache: TtlCache<Candidate[]>; private poiFlight = new InFlight<Candidate[]>();

  constructor(private o: OsmOptions = {}) {
    this.clock = o.clock ?? realClock;
    this.ua = o.userAgent ?? DEFAULT_USER_AGENT;
    this.log = o.log ?? (e => console.log(JSON.stringify(e)));
    const c = this.clock;
    this.svc = {
      nominatim: { name: 'Geocoding service (Nominatim)', throttle: new Throttle(o.nominatimGapMs ?? 1100, c), timeoutMs: o.timeoutMs?.nominatim ?? 10_000, retries: o.retries?.nominatim ?? 2 },
      osrm: { name: 'Routing service (OSRM)', throttle: new Throttle(o.osrmGapMs ?? 1100, c), timeoutMs: o.timeoutMs?.osrm ?? 20_000, retries: o.retries?.osrm ?? 2 },
      overpass: { name: 'Places service (Overpass)', throttle: new Throttle(o.overpassGapMs ?? 1000, c), timeoutMs: o.timeoutMs?.overpass ?? 30_000, retries: o.retries?.overpass ?? 1 },
    };
    this.urls = { nominatim: o.nominatimUrl ?? NOMINATIM_URL, osrm: (o.osrmUrl ?? OSRM_URL).replace(/\/?$/, '/'), overpass: o.overpassUrl ?? OVERPASS_URL };
    this.geoCache = new TtlCache(o.geocodeTtlMs ?? 7 * 24 * 3600_000, 500, c);
    this.routeCache = new TtlCache(o.routeTtlMs ?? 30 * 60_000, 100, c);
    this.poiCache = new TtlCache(o.poiTtlMs ?? 6 * 3600_000, 300, c);
  }

  // One HTTP attempt, bounded by a timeout. Never throws: failures are returned so the retry loop can decide.
  private async once(svc: Service, url: string, init: RequestInit): Promise<Attempt> {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), svc.timeoutMs); const t0 = this.clock.now();
    try {
      const doFetch = this.o.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
      const res = await doFetch(url, { ...init, signal: ctl.signal, headers: { 'User-Agent': this.ua, Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) } });
      const text = await res.text();
      let body: any; try { body = JSON.parse(text); } catch { body = undefined; }
      this.log({ api: new URL(url).host, status: res.status, ms: this.clock.now() - t0 }); // host and status only: no query text
      return { status: res.status, body, text, retryAfterMs: parseRetryAfter(res.headers.get('retry-after'), this.clock.now()) };
    } catch (e) {
      this.log({ api: new URL(url).host, failure: (e as Error).name === 'AbortError' ? 'timeout' : 'network' });
      return { failure: (e as Error).name === 'AbortError' ? 'timeout' : 'network' };
    } finally { clearTimeout(timer); }
  }

  /** Throttled request with timeout, and backoff retries for network errors, timeouts, 429 and 5xx only. Other statuses are returned. */
  private async request(svc: Service, url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
    const backoff = this.o.backoffMs ?? 1000, maxWait = this.o.maxRetryAfterMs ?? 10_000;
    for (let attempt = 0; ; attempt++) {
      const a = await svc.throttle.run(() => this.once(svc, url, init));
      let err: ProviderError, retryAfterMs: number | undefined;
      if ('failure' in a) err = a.failure === 'timeout' ? new ProviderError(`${svc.name} timed out.`, 504) : new ProviderError(`${svc.name} is unreachable.`, 502);
      else if (a.status === 429) { err = new ProviderError(`${svc.name} is limiting requests right now. Wait a minute and try again.`, 429); retryAfterMs = a.retryAfterMs; }
      else if (a.status >= 500) { err = new ProviderError(`${svc.name} is temporarily unavailable (HTTP ${a.status}).`, 502); retryAfterMs = a.retryAfterMs; }
      else return { status: a.status, body: a.body };
      if (attempt >= svc.retries || (retryAfterMs !== undefined && retryAfterMs > maxWait)) throw err;
      await this.clock.sleep(Math.max(backoff * 2 ** attempt, retryAfterMs ?? 0));
    }
  }

  /** Place text -> coordinates. Explicit "lat,lng" needs no network. Successful lookups are cached; requests are sequential and spaced. */
  async geocode(place: string | LatLng): Promise<LatLng> {
    if (typeof place !== 'string') return place;
    const direct = parseLatLng(place);
    if (direct) return direct;
    const q = place.trim().replace(/\s+/g, ' ');
    if (q.length < 2) throw new ProviderError('Enter a place name for the start and the destination.', 400);
    return cachedOnce(this.geoCache, this.geoFlight, q.toLowerCase(), async () => {
      const url = `${this.urls.nominatim}?${new URLSearchParams({ q, format: 'jsonv2', limit: '1', countrycodes: this.o.countryCodes ?? 'in', 'accept-language': 'en' })}`;
      const { status, body } = await this.request(this.svc.nominatim, url);
      if (status !== 200) throw new ProviderError(`Geocoding service rejected the request (HTTP ${status}). If this persists, check OSM_CONTACT and the Nominatim usage policy.`);
      if (!Array.isArray(body)) throw new ProviderError('Geocoding service returned an unreadable response.');
      if (body.length === 0) throw new ProviderError(`Could not find "${q.slice(0, 80)}". Try adding the state or a nearby town.`, 404);
      const lat = Number(body[0]?.lat), lng = Number(body[0]?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new ProviderError('Geocoding service returned an invalid location.');
      return { lat, lng };
    });
  }

  /** One OSRM driving route. Public OSRM has no live traffic and no toll data, so trafficAware is false and tollInr is unknown. */
  async route(r: RouteReq): Promise<RouteResult[]> {
    const a = await this.geocode(r.origin), b = await this.geocode(r.destination); // sequential on purpose
    const useExclude = r.avoidTolls && !!this.o.osrmExcludeToll;
    const f = (p: LatLng) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;
    const key = `${f(a)};${f(b)}|${useExclude ? 'notoll' : 'any'}`; // departure time is irrelevant without traffic, so it is not part of the key
    const result = await cachedOnce(this.routeCache, this.routeFlight, key, async () => {
      const params = new URLSearchParams({ overview: 'full', geometries: 'geojson', alternatives: 'false', steps: 'false', ...(useExclude ? { exclude: 'toll' } : {}) });
      const { status, body } = await this.request(this.svc.osrm, `${this.urls.osrm}${f(a)};${f(b)}?${params}`);
      if (status !== 200 && !(body && typeof body.code === 'string')) throw new ProviderError(`Routing service rejected the request (HTTP ${status}).`);
      const parsed = parseOsrmRoute(body);
      const notes = ['Duration is a free-flow estimate from OpenStreetMap road data. Live traffic and road closures are not included.'];
      if (r.avoidTolls && !useExclude) notes.push('Toll avoidance could not be applied because the routing service has no toll data, so this route may include tolls.');
      return { ...parsed, notes };
    });
    return [{ ...result, notes: result.notes ? [...result.notes] : undefined }];
  }

  /** Places of one kind within a bounded corridor around a short slice of the route. */
  async searchAlong(s: SearchReq): Promise<Candidate[]> {
    const slice = decode(s.slicePolyline);
    if (slice.length < 2) throw new ProviderError('The search area is empty.', 400);
    if (cumulativeKm(slice).at(-1)! > MAX_SLICE_KM) throw new ProviderError(`Search area is too large (over ${MAX_SLICE_KM} km of road); not sent to the public places service.`, 400);
    const route = thinPolyline(slice, 1, 60);
    const query = buildOverpassQuery(s.kind, route, { vegOnly: s.vegOnly, electric: s.electric });
    const list = await cachedOnce(this.poiCache, this.poiFlight, query, async () => {
      const { status, body } = await this.request(this.svc.overpass, this.urls.overpass, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}` });
      if (status !== 200) throw new ProviderError(`Places service rejected the request (HTTP ${status}).`);
      if (!body || !Array.isArray(body.elements)) throw new ProviderError('Places service returned an unreadable response.');
      if (typeof body.remark === 'string' && /runtime error|timed out|out of memory/i.test(body.remark)) throw new ProviderError('Places service ran out of time on this query. Try again shortly.', 504);
      return mapOverpassElements(body.elements, s.kind, route);
    });
    return list.map(c => ({ ...c }));
  }
}
