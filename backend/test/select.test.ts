import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createProvider, healthInfo, resolveProviderName, OSM_NOTICE } from '../src/providers/select.ts';
import { OsmProvider } from '../src/providers/osm.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { GoogleProvider } from '../src/providers/google.ts';

test('default provider is OpenStreetMap, with no environment at all', () => {
  assert.equal(resolveProviderName({}), 'osm'); assert.equal(resolveProviderName({ MAPS_PROVIDER: '' }), 'osm'); assert.equal(resolveProviderName({ MAPS_PROVIDER: ' OSM ' }), 'osm');
  const p = createProvider({}, () => assert.fail('no warning expected'));
  assert.ok(p instanceof OsmProvider); assert.equal(p.source, 'osm');
});
test('MAPS_PROVIDER=mock still selects the mock provider (for tests)', () => {
  const p = createProvider({ MAPS_PROVIDER: 'mock' }); assert.ok(p instanceof MockProvider); assert.equal(p.source, 'mock');
});
test('Google is opt-in only, and a missing Google key never prevents startup', () => {
  const warnings: string[] = [];
  const p = createProvider({ MAPS_PROVIDER: 'google' }, m => warnings.push(m));
  assert.equal(p.source, 'osm'); assert.ok(p instanceof OsmProvider);
  assert.equal(warnings.length, 1); assert.match(warnings[0], /GOOGLE_SERVER_API_KEY/);
  const g = createProvider({ MAPS_PROVIDER: 'google', GOOGLE_SERVER_API_KEY: 'k' }); assert.ok(g instanceof GoogleProvider); assert.equal(g.source, 'google');
  assert.equal(createProvider({ GOOGLE_SERVER_API_KEY: 'k' }).source, 'osm', 'a key alone does not switch providers');
});
test('a mistyped MAPS_PROVIDER fails loudly instead of silently using something else', () => {
  assert.throws(() => resolveProviderName({ MAPS_PROVIDER: 'goggle' }), /Unknown MAPS_PROVIDER "goggle"/);
});
test('health: OSM is identified, attributed, and explicitly reports no live traffic or toll prices', () => {
  const h = healthInfo(createProvider({}));
  assert.equal(h.ok, true); assert.equal(h.provider, 'osm'); assert.equal(h.live, true); assert.equal(h.liveTraffic, false); assert.equal(h.tollPrices, false);
  assert.equal(h.attribution, '© OpenStreetMap contributors'); assert.equal(h.notice, OSM_NOTICE);
  assert.match(h.notice!, /Live traffic, verified toll prices, ratings and opening hours may not be available/);
});
test('health: mock is never reported as live data; only Google would report traffic', () => {
  const m = healthInfo(new MockProvider()); assert.equal(m.provider, 'mock'); assert.equal(m.live, false); assert.equal(m.liveTraffic, false); assert.match(m.notice!, /sample data/);
  const g = healthInfo(new GoogleProvider('k')); assert.equal(g.provider, 'google'); assert.equal(g.liveTraffic, true);
});

// Starts the real server (src/server.ts) in a child process and reads /api/health.
async function healthFrom(env: Record<string, string>, port: number): Promise<any> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(MAPS_PROVIDER|GOOGLE_|SUPABASE_|OSM_|NOMINATIM_|OSRM_|OVERPASS_)/.test(k)) clean[k] = v;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { env: { ...clean, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => (log += d)); child.stderr.on('data', d => (log += d));
  let exited: number | null = null; child.on('exit', c => (exited = c ?? -1));
  try {
    for (let i = 0; i < 100; i++) {
      if (exited !== null) throw new Error(`server exited with ${exited}:\n${log}`);
      try { const res = await fetch(`http://127.0.0.1:${port}/api/health`); if (res.ok) return await res.json(); } catch { /* not up yet */ }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`server did not start:\n${log}`);
  } finally { child.kill(); }
}
test('server starts with no Google key and no provider variable: OSM mode', async () => {
  const h = await healthFrom({}, 18091);
  assert.equal(h.provider, 'osm'); assert.equal(h.liveTraffic, false); assert.equal(h.attribution, '© OpenStreetMap contributors');
});
test('server starts with MAPS_PROVIDER=google but no key: falls back to OSM instead of crashing', async () => {
  assert.equal((await healthFrom({ MAPS_PROVIDER: 'google' }, 18092)).provider, 'osm');
});
test('server in mock mode reports mock', async () => {
  const h = await healthFrom({ MAPS_PROVIDER: 'mock' }, 18093); assert.equal(h.provider, 'mock'); assert.equal(h.live, false);
});
