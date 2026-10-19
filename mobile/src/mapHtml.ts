import type { StopKind } from './types';

// Builds the page shown inside the map WebView: Leaflet + OpenStreetMap raster tiles. No Google Maps SDK, JavaScript API or key.
// Leaflet is loaded from a CDN (with integrity hashes), so the map needs an internet connection. There is no offline tile support.

export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
/** Identifies this app to the OpenStreetMap tile servers (their usage policy asks for a valid Referer or User-Agent). */
export const MAP_BASE_URL = 'https://github.com/akshaykpv94/roadtrip-planner';
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist';
const LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
const LEAFLET_JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';

export interface MapStop { id: string; kind: StopKind; n: number; name: string; lat: number; lng: number }
export interface MapInput { route: { lat: number; lng: number }[]; stops: MapStop[]; colors: Record<StopKind, string>; routeColor: string }

const KINDS: StopKind[] = ['food', 'fuel', 'hotel', 'sight', 'rest'];
const okLat = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 90;
const okLng = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 180;
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * JSON that is safe to place inside an inline <script>: `<`, `>`, `&` and the JS line separators are written as \uXXXX escapes,
 * so no value (a place name from OpenStreetMap, say) can close the script tag or inject markup.
 */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** Drops anything malformed before it reaches the page: bad coordinates, unknown kinds, over-long names. */
export function sanitizeMapInput(i: MapInput) {
  return {
    route: i.route.filter(p => okLat(p?.lat) && okLng(p?.lng)).map(p => [r5(p.lat), r5(p.lng)]),
    stops: i.stops.filter(s => typeof s?.id === 'string' && KINDS.includes(s.kind) && okLat(s.lat) && okLng(s.lng))
      .map(s => ({ id: s.id.slice(0, 120), kind: s.kind, n: Math.max(0, Math.floor(Number(s.n)) || 0), name: String(s.name ?? '').slice(0, 120), lat: r5(s.lat), lng: r5(s.lng) })),
    colors: Object.fromEntries(KINDS.map(k => [k, hex(i.colors?.[k], '#444444')])),
    routeColor: hex(i.routeColor, '#0F5B3E'),
  };
}

export function buildMapHtml(input: MapInput, nonce = Math.random().toString(36).slice(2) + Date.now().toString(36)): string {
  const data = safeJson(sanitizeMapInput(input));
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' https://unpkg.com; style-src 'unsafe-inline' https://unpkg.com; ` +
    `img-src https://tile.openstreetmap.org https://unpkg.com data:; connect-src 'none'; font-src 'none'; form-action 'none'`;
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${LEAFLET}/leaflet.css" integrity="${LEAFLET_CSS_SRI}" crossorigin="anonymous">
<style>
html,body,#map{height:100%;margin:0;background:#E8E6DF}
.pin{position:relative;width:34px;height:34px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-size:17px;line-height:1;box-sizing:border-box}
.pin .n{position:absolute;top:-7px;right:-7px;min-width:16px;height:16px;padding:0 3px;border-radius:8px;background:#1B1E20;color:#fff;font:700 10px/16px sans-serif;text-align:center;box-sizing:border-box}
</style></head>
<body><div id="map"></div>
<script src="${LEAFLET}/leaflet.js" integrity="${LEAFLET_JS_SRI}" crossorigin="anonymous"></script>
<script nonce="${nonce}">
(function () {
  var DATA = ${data};
  var GLYPH = { fuel: '\\u26FD', food: '\\uD83C\\uDF74', hotel: '\\uD83C\\uDFE8', rest: '\\u2615', sight: '\\uD83D\\uDCF7' };
  function post(m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }
  function fail(msg) { post({ type: 'error', message: msg }); }
  window.addEventListener('error', function () { fail('The map could not start.'); });
  window.addEventListener('load', function () {
    if (!window.L) { fail('The map library could not be loaded. Check your internet connection.'); return; }
    try { build(); } catch (e) { fail('The map could not be drawn.'); }
  });
  function pin(s) {
    var el = document.createElement('div'); el.className = 'pin'; el.style.background = DATA.colors[s.kind];
    el.appendChild(document.createTextNode(GLYPH[s.kind] || '\\u2022'));
    var n = document.createElement('span'); n.className = 'n'; n.textContent = String(s.n); el.appendChild(n);
    return L.divIcon({ html: el, className: '', iconSize: [34, 34], iconAnchor: [17, 17] });
  }
  function build() {
    var map = L.map('map', { preferCanvas: true });
    map.attributionControl.setPrefix(false);
    var loaded = 0, errors = 0, warned = false;
    var tiles = L.tileLayer(${safeJson(TILE_URL)}, {
      maxZoom: 19, referrerPolicy: 'unsafe-url',
      attribution: '\\u00A9 <a href="${OSM_COPYRIGHT_URL}">OpenStreetMap</a> contributors'
    }).addTo(map);
    tiles.on('tileload', function () { loaded++; if (warned) { warned = false; post({ type: 'tiles-ok' }); } });
    tiles.on('tileerror', function () { errors++; if (!loaded && errors >= 4 && !warned) { warned = true; post({ type: 'tiles-error' }); } });
    var bounds = L.latLngBounds([]);
    if (DATA.route.length > 1) {
      L.polyline(DATA.route, { color: DATA.routeColor, weight: 5, opacity: 0.9 }).addTo(map);
      [DATA.route[0], DATA.route[DATA.route.length - 1]].forEach(function (p) {
        L.circleMarker(p, { radius: 7, color: '#fff', weight: 3, fillColor: '#1B1E20', fillOpacity: 1 }).addTo(map);
      });
      DATA.route.forEach(function (p) { bounds.extend(p); });
    }
    DATA.stops.forEach(function (s) {
      var m = L.marker([s.lat, s.lng], { icon: pin(s), title: s.name, keyboard: true }).addTo(map);
      m.on('click', function () { post({ type: 'select', id: s.id }); });
      bounds.extend([s.lat, s.lng]);
    });
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 }); else map.setView([22.5, 79], 5);
    window.addEventListener('resize', function () { map.invalidateSize(); });
    map.whenReady(function () { post({ type: 'ready' }); });
  }
})();
</script></body></html>`;
}
