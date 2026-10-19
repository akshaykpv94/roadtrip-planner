export interface LatLng { lat: number; lng: number }

export function decode(str: string): LatLng[] {
  const out: LatLng[] = []; let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 31) << shift; shift += 5; } while (b >= 32);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lng += d;
    }
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

export function encode(pts: LatLng[]): string {
  let out = '', pl = 0, pg = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1, s = '';
    while (n >= 32) { s += String.fromCharCode((32 | (n & 31)) + 63); n >>= 5; }
    return s + String.fromCharCode(n + 63);
  };
  for (const p of pts) {
    const la = Math.round(p.lat * 1e5), lg = Math.round(p.lng * 1e5);
    out += enc(la - pl) + enc(lg - pg); pl = la; pg = lg;
  }
  return out;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Cumulative distance along the polyline (km), same length as pts. Used only for positions on the route, never as trip distance. */
export function cumulativeKm(pts: LatLng[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineKm(pts[i - 1], pts[i]));
  return cum;
}

export function pointAtKm(pts: LatLng[], cum: number[], km: number): LatLng {
  if (km <= 0) return pts[0];
  if (km >= cum[cum.length - 1]) return pts[pts.length - 1];
  let i = 1; while (cum[i] < km) i++;
  const f = (km - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return { lat: pts[i - 1].lat + f * (pts[i].lat - pts[i - 1].lat), lng: pts[i - 1].lng + f * (pts[i].lng - pts[i - 1].lng) };
}

export function sliceKm(pts: LatLng[], cum: number[], fromKm: number, toKm: number): LatLng[] {
  const a = Math.max(0, fromKm), b = Math.min(cum[cum.length - 1], toKm);
  const mid = pts.filter((_, i) => cum[i] > a && cum[i] < b);
  return [pointAtKm(pts, cum, a), ...mid, pointAtKm(pts, cum, b)];
}
