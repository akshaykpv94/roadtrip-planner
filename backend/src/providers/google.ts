import type { Candidate, Kind, MapsProvider, RouteReq, RouteResult, SearchReq } from './types.ts';
import { ProviderError } from './types.ts';
import { detourFromSummary } from '../lib/ranking.ts';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const secs = (d?: string) => (d ? parseInt(d.replace('s', ''), 10) : 0);
const wp = (p: string | { lat: number; lng: number }) =>
  typeof p === 'string' ? { address: p } : { location: { latLng: { latitude: p.lat, longitude: p.lng } } };

const QUERY: Record<Kind, { text: string; type?: string }> = {
  fuel: { text: 'petrol pump', type: 'gas_station' },
  food: { text: 'restaurant dhaba', type: 'restaurant' },
  hotel: { text: 'hotel', type: 'lodging' },
  rest: { text: 'tea coffee shop' },
  sight: { text: 'tourist attraction' },
};

export class GoogleProvider implements MapsProvider {
  source = 'google' as const;
  private calls = 0; private day = new Date().toDateString();
  constructor(private key: string, private maxCallsPerDay = 500, private timeoutMs = 10_000) {}

  /** Hard daily cap so a bug or abuse cannot run up the Google bill. */
  private guard() {
    const today = new Date().toDateString();
    if (today !== this.day) { this.day = today; this.calls = 0; }
    if (++this.calls > this.maxCallsPerDay) throw new ProviderError('Daily Google API call limit reached.', 429);
  }

  private async post(url: string, fieldMask: string, body?: unknown): Promise<any> {
    this.guard();
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(url, { method: body === undefined ? 'GET' : 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.key, 'X-Goog-FieldMask': fieldMask },
        body: body === undefined ? undefined : JSON.stringify(body) });
      console.log(JSON.stringify({ api: new URL(url).host, status: res.status, ms: Date.now() - started })); // never logs the key
      if (!res.ok) throw new ProviderError(`Google API returned ${res.status}`, res.status === 429 ? 429 : 502);
      return await res.json();
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError((e as Error).name === 'AbortError' ? 'Google API timed out' : 'Google API unreachable');
    } finally { clearTimeout(t); }
  }

  async route(r: RouteReq): Promise<RouteResult[]> {
    const json = await this.post(ROUTES_URL,
      'routes.distanceMeters,routes.duration,routes.staticDuration,routes.description,routes.polyline.encodedPolyline,routes.travelAdvisory.tollInfo',
      { origin: wp(r.origin), destination: wp(r.destination), travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE_OPTIMAL', departureTime: r.departure.toISOString(),
        computeAlternativeRoutes: r.alternatives, extraComputations: ['TOLLS'],
        routeModifiers: { avoidTolls: r.avoidTolls }, regionCode: 'IN', units: 'METRIC' });
    if (!json.routes?.length) throw new ProviderError('No route found between these places.', 404);
    return json.routes.map((x: any): RouteResult => {
      const inr = x.travelAdvisory?.tollInfo?.estimatedPrice?.find((p: any) => p.currencyCode === 'INR');
      return { distanceKm: x.distanceMeters / 1000, durationSec: secs(x.duration), staticDurationSec: secs(x.staticDuration),
        polyline: x.polyline.encodedPolyline, label: x.description, trafficAware: true,
        tollInr: inr ? Number(inr.units ?? 0) + (inr.nanos ?? 0) / 1e9 : undefined };
    });
  }

  async searchAlong(s: SearchReq): Promise<Candidate[]> {
    const q = s.electric && s.kind === 'fuel' ? { text: 'EV charging station', type: 'electric_vehicle_charging_station' } : QUERY[s.kind];
    const text = s.vegOnly && s.kind === 'food' ? 'vegetarian restaurant' : q.text;
    const json = await this.post(PLACES_URL,
      'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.regularOpeningHours.periods,places.nationalPhoneNumber,places.googleMapsUri,routingSummaries',
      { textQuery: text, ...(q.type ? { includedType: q.type } : {}), maxResultCount: 10, languageCode: 'en', regionCode: 'IN',
        searchAlongRouteParameters: { polyline: { encodedPolyline: s.slicePolyline } },
        routingParameters: { origin: { latitude: s.origin.lat, longitude: s.origin.lng }, travelMode: 'DRIVE' } });
    return (json.places ?? []).map((p: any, i: number): Candidate => {
      const legs = json.routingSummaries?.[i]?.legs;
      const d = legs?.length === 2 ? detourFromSummary(
        { km: legs[0].distanceMeters / 1000, sec: secs(legs[0].duration) },
        { km: legs[1].distanceMeters / 1000, sec: secs(legs[1].duration) }, s.sliceKm, s.sliceSec) : undefined;
      return { id: p.id, name: p.displayName?.text ?? 'Unnamed place', address: p.formattedAddress,
        lat: p.location.latitude, lng: p.location.longitude, rating: p.rating, reviews: p.userRatingCount,
        phone: p.nationalPhoneNumber, mapsUri: p.googleMapsUri, openPeriods: p.regularOpeningHours?.periods,
        detourKm: d?.km, detourMin: d?.min };
    });
  }

  async details(ids: string[]): Promise<Record<string, Candidate>> {
    const out: Record<string, Candidate> = {};
    await Promise.all([...new Set(ids)].map(async id => {
      try {
        const p = await this.post(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`,
          'id,displayName,formattedAddress,location,rating,userRatingCount,regularOpeningHours.periods,nationalPhoneNumber,googleMapsUri');
        out[id] = { id, name: p.displayName?.text ?? 'Unnamed place', address: p.formattedAddress, lat: p.location.latitude, lng: p.location.longitude,
          rating: p.rating, reviews: p.userRatingCount, phone: p.nationalPhoneNumber, mapsUri: p.googleMapsUri, openPeriods: p.regularOpeningHours?.periods };
      } catch { /* leave absent; caller marks the stop as unavailable */ }
    }));
    return out;
  }
}
