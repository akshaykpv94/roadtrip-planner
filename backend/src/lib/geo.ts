import { haversineKm, type LatLng } from './polyline.ts';

/**
 * Shortest distance (km) from a point to a polyline. Uses a local flat projection around the point, which is accurate to
 * well under 1% over the tens of kilometres involved here. This is straight-line distance, not road distance.
 */
export function distToPolylineKm(p: LatLng, pts: LatLng[]): number {
  if (pts.length === 0) return Number.POSITIVE_INFINITY;
  if (pts.length === 1) return haversineKm(p, pts[0]);
  const kLat = 111.32, kLng = 111.32 * Math.cos((p.lat * Math.PI) / 180);
  const xy = pts.map(q => ({ x: (q.lng - p.lng) * kLng, y: (q.lat - p.lat) * kLat }));
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1], b = xy[i], dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
}

/** Keeps a point only if it is at least `minKm` from the last kept point; always keeps the ends. Caps the result at `maxPoints`. */
export function thinPolyline(pts: LatLng[], minKm: number, maxPoints: number): LatLng[] {
  if (pts.length <= 2) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) if (haversineKm(out[out.length - 1], pts[i]) >= minKm) out.push(pts[i]);
  out.push(pts[pts.length - 1]);
  if (out.length <= maxPoints) return out;
  const step = (out.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => out[Math.min(out.length - 1, Math.round(i * step))]);
}
