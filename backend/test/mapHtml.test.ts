import test from 'node:test';
import assert from 'node:assert/strict';
// The map page builder lives in the mobile app but is pure TypeScript (no React Native imports), so it is tested here.
import { buildMapHtml, safeJson, sanitizeMapInput, MAP_BASE_URL, OSM_COPYRIGHT_URL, TILE_URL, type MapInput } from '../../mobile/src/mapHtml.ts';

const colors = { food: '#C2562A', fuel: '#1F4E8C', hotel: '#6A3FA0', sight: '#0F5B3E', rest: '#6B7075' };
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const hostile = `Dhaba </script><img src=x onerror=alert(1)><!-- ${LS}${PS} ' " \\ &amp;`;
const input = (over: Partial<MapInput> = {}): MapInput => ({
  route: [{ lat: 18.5, lng: 73.8 }, { lat: 12.9, lng: 77.5 }], colors, routeColor: '#0F5B3E',
  stops: [{ id: 'osm-node-1', kind: 'food', n: 1, name: hostile, lat: 16, lng: 75 }], ...over });

test('safeJson never emits characters that can end a script block, and still round-trips exactly', () => {
  const out = safeJson({ name: hostile });
  for (const bad of ['<', '>', '&', LS, PS]) assert.ok(!out.includes(bad), `contains ${JSON.stringify(bad)}`);
  assert.deepEqual(JSON.parse(out), { name: hostile });
});
test('sanitize: drops malformed stops and points, caps lengths, rejects odd colours', () => {
  const s = sanitizeMapInput(input({
    route: [{ lat: 1, lng: 2 }, { lat: NaN, lng: 2 }, { lat: 95, lng: 2 }, { lat: 3, lng: 4 }],
    stops: [
      { id: 'ok', kind: 'fuel', n: 1, name: 'x'.repeat(500), lat: 10, lng: 20 },
      { id: 'bad-kind', kind: 'spaceport' as any, n: 2, name: 'x', lat: 10, lng: 20 },
      { id: 'bad-lat', kind: 'fuel', n: 3, name: 'x', lat: 999, lng: 20 },
      { id: 'nan', kind: 'fuel', n: 4, name: 'x', lat: Number.NaN, lng: 20 },
    ],
    colors: { ...colors, food: 'red;} body{display:none' }, routeColor: 'url(javascript:alert(1))' }));
  assert.equal(s.route.length, 2); assert.equal(s.stops.length, 1); assert.equal(s.stops[0].name.length, 120);
  assert.equal(s.colors.food, '#444444'); assert.equal(s.routeColor, '#0F5B3E');
});
test('page: OpenStreetMap tiles and attribution, integrity-checked Leaflet, strict CSP, hostile text cannot break out', () => {
  const html = buildMapHtml(input(), 'abc123');
  assert.ok(html.includes(TILE_URL)); assert.equal(TILE_URL, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.ok(html.includes('contributors') && html.includes(OSM_COPYRIGHT_URL)); assert.equal(MAP_BASE_URL, 'https://github.com/akshaykpv94/roadtrip-planner');
  assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.js" integrity="sha256-[A-Za-z0-9+/=]+" crossorigin="anonymous"/);
  assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.css" integrity="sha256-[A-Za-z0-9+/=]+" crossorigin="anonymous"/);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; script-src 'nonce-abc123' https:\/\/unpkg\.com;/); assert.ok(html.includes('connect-src \'none\''));
  assert.equal((html.match(/<script/g) ?? []).length, 2, 'only the Leaflet tag and our own inline script');
  assert.ok(!html.includes('</script><img') && !html.includes('<!--') && !html.includes(LS) && !html.includes(PS), 'dynamic data cannot close the script or inject markup');
  const m = /var DATA = (\{.*\});/.exec(html)!; assert.equal(JSON.parse(m[1]).stops[0].name, hostile.slice(0, 120));
});
test('no Google Maps service is referenced anywhere in the page', () => assert.ok(!/google|gstatic|maps\.googleapis/i.test(buildMapHtml(input()))));
