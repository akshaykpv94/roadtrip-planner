import type { Candidate, MapsProvider, RouteReq, RouteResult, SearchReq } from './types.ts';
import { encode, haversineKm, pointAtKm, cumulativeKm, decode, type LatLng } from '../lib/polyline.ts';

// MOCK provider for tests and keyless development. Geometry is a rough straight-line path between
// real towns; names are obviously fake. Output is labelled source "mock" and must never be shown as live.
const WAYPOINTS: LatLng[] = [
  { lat: 18.5204, lng: 73.8567 }, { lat: 16.705, lng: 74.2433 }, { lat: 15.8497, lng: 74.4977 },
  { lat: 15.3647, lng: 75.124 }, { lat: 14.4644, lng: 75.9218 }, { lat: 13.3409, lng: 77.1010 },
  { lat: 12.9716, lng: 77.5946 }, { lat: 12.2958, lng: 76.6394 }, { lat: 11.6, lng: 76.2 },
  { lat: 11.2588, lng: 75.7804 }, { lat: 11.1186, lng: 76.1203 },
];
const ROAD_FACTOR = 1.25, AVG_KMH = 55;

export class MockProvider implements MapsProvider {
  source = 'mock' as const;
  async route(r: RouteReq): Promise<RouteResult[]> {
    const dense: LatLng[] = [];
    for (let i = 1; i < WAYPOINTS.length; i++) for (let k = 0; k < 20; k++) {
      const a = WAYPOINTS[i - 1], b = WAYPOINTS[i], f = k / 20;
      dense.push({ lat: a.lat + f * (b.lat - a.lat), lng: a.lng + f * (b.lng - a.lng) });
    }
    dense.push(WAYPOINTS[WAYPOINTS.length - 1]);
    const km = cumulativeKm(dense).at(-1)! * ROAD_FACTOR;
    const sec = (km / AVG_KMH) * 3600;
    return [{ distanceKm: km, durationSec: sec, staticDurationSec: sec, polyline: encode(dense), tollInr: r.avoidTolls ? 0 : Math.round(km * 1.6), trafficAware: false, label: 'mock route' }];
  }
  async searchAlong(s: SearchReq): Promise<Candidate[]> {
    const pts = decode(s.slicePolyline), cum = cumulativeKm(pts);
    return [0.3, 0.5, 0.7].map((f, i): Candidate => {
      const p = pointAtKm(pts, cum, cum.at(-1)! * f);
      return { id: `mock-${s.kind}-${Math.round(p.lat * 1e3)}-${i}`, name: `Mock ${s.kind} ${'ABC'[i]}`, lat: p.lat, lng: p.lng,
        rating: i === 2 ? undefined : 4 - i * 0.3, reviews: i === 2 ? undefined : 500 - i * 200,
        detourKm: 0.5 + i, detourMin: 2 + i * 3 };
    });
  }
}
void haversineKm;
