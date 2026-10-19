import { decode } from './lib/polyline.ts';
import type { Candidate, MapsProvider, TripSource } from './providers/types.ts';

export interface TripRow { id: string; title: string; source: TripSource; request: TripRequestMeta; itinerary: any; created_at: string; updated_at: string }
export interface TripRequestMeta { from: string; to: string; departure: string; avoidTolls: boolean }
export interface TripRepo {
  list(): Promise<Pick<TripRow, 'id' | 'title' | 'source' | 'created_at' | 'updated_at'>[]>;
  get(id: string): Promise<TripRow | null>;
  create(r: { title: string; source: TripSource; request: TripRequestMeta; itinerary: any }): Promise<TripRow>;
  update(id: string, r: { title: string; itinerary: any }): Promise<TripRow | null>;
  remove(id: string): Promise<boolean>;
}

/**
 * What we persist. Trips from Google data ('live') keep only place IDs and the user's own state: Google content (names,
 * addresses, ratings, hours, phones, coordinates, route geometry) is not stored, following my reading of Google's caching
 * rules, and is re-fetched when a trip is opened. Verify against the current Google Maps Platform Terms before relying on it.
 * Trips from OpenStreetMap ('osm') and mock trips are stored whole: OSM data is open (ODbL) and is shown with attribution.
 */
export function toStorable(trip: any) {
  const live = trip.source === 'live';
  return {
    totalKm: trip.totalKm, drivingMin: trip.drivingMin, budget: trip.budget, warnings: trip.warnings ?? [],
    days: (trip.days ?? []).map((d: any) => ({ ...d, stops: (d.stops ?? []).map((s: any) => live
      ? { id: s.id, kind: s.kind, eta: s.eta, stayMin: s.stayMin, status: s.status, detourKm: s.detourKm, detourMin: s.detourMin }
      : s) })),
    polyline: live ? [] : trip.polyline,
  };
}

const downsample = (pts: { lat: number; lng: number }[]) => { const k = Math.max(1, Math.floor(pts.length / 300)); return pts.filter((_, i) => i % k === 0 || i === pts.length - 1); };

/** Rebuild a full trip for the app: place details by ID and the route line are fetched fresh. */
export async function hydrate(row: TripRow, provider: MapsProvider) {
  const trip: any = { id: row.id, savedId: row.id, title: row.title, source: row.source, req: row.request, ...row.itinerary, warnings: [...(row.itinerary.warnings ?? [])] };
  if (row.source === 'mock' || row.source === 'osm') return trip; // stored whole; nothing to re-fetch
  if (provider.source !== 'google') { // an older trip saved from Google data, opened while the server is not using Google
    trip.days = trip.days.map((d: any) => ({ ...d, stops: d.stops.map((s: any) => ({ ...s, name: 'Place details unavailable', lat: 0, lng: 0, unavailable: true })) }));
    trip.polyline = trip.polyline ?? [];
    trip.warnings.push('This trip was saved from Google data, which this server is not using. Place names and the route line cannot be shown.');
    return trip;
  }
  const ids: string[] = trip.days.flatMap((d: any) => d.stops.map((s: any) => s.id));
  const details: Record<string, Candidate> = provider.details ? await provider.details(ids) : {};
  let missing = 0;
  trip.days = trip.days.map((d: any) => ({ ...d, stops: d.stops.map((s: any) => {
    const p = details[s.id];
    if (!p) { missing++; return { ...s, name: 'Place details unavailable', lat: 0, lng: 0, unavailable: true }; }
    return { ...s, name: p.name, address: p.address, lat: p.lat, lng: p.lng, rating: p.rating, reviews: p.reviews, phone: p.phone, mapsUri: p.mapsUri };
  }) }));
  if (missing) trip.warnings.push(`${missing} place${missing > 1 ? 's' : ''} could not be loaded. Opening hours and details may be out of date.`);
  try {
    const dep = new Date(Math.max(Date.now() + 60_000, new Date(row.request.departure).getTime()));
    const [r] = await provider.route({ origin: row.request.from, destination: row.request.to, departure: dep, avoidTolls: row.request.avoidTolls, alternatives: false });
    trip.polyline = downsample(decode(r.polyline)); trip.trafficAware = r.trafficAware;
  } catch { trip.polyline = []; trip.warnings.push('Could not load the route line. Stops are shown without it.'); }
  return trip;
}

export class MemoryRepo implements TripRepo {
  private rows = new Map<string, TripRow & { user: string }>(); private n = 0;
  constructor(private user: string, private shared = new Map<string, TripRow & { user: string }>()) { this.rows = shared; }
  forUser(user: string) { return new MemoryRepo(user, this.rows); }
  async list() { return [...this.rows.values()].filter(r => r.user === this.user).map(({ id, title, source, created_at, updated_at }) => ({ id, title, source, created_at, updated_at })); }
  async get(id: string) { const r = this.rows.get(id); return r && r.user === this.user ? r : null; }
  async create(r: Parameters<TripRepo['create']>[0]) { const now = new Date().toISOString(); const row = { id: `t${++this.n}`, user: this.user, created_at: now, updated_at: now, ...r }; this.rows.set(row.id, row); return row; }
  async update(id: string, r: { title: string; itinerary: any }) { const x = await this.get(id); if (!x) return null; Object.assign(x, r, { updated_at: new Date().toISOString() }); return x; }
  async remove(id: string) { return (await this.get(id)) ? this.rows.delete(id) : false; }
}
