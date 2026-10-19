import type { MapsProvider, ProviderSource } from './types.ts';
import { OsmProvider, OSM_ATTRIBUTION, DEFAULT_USER_AGENT } from './osm.ts';
import { MockProvider } from './mock.ts';
import { GoogleProvider } from './google.ts';

type Env = Record<string, string | undefined>;

export const OSM_NOTICE = 'Routes use OpenStreetMap data. Live traffic, verified toll prices, ratings and opening hours may not be available.';
export const MOCK_NOTICE = 'Mock mode: itineraries are sample data, not real routes or places.';

/** OpenStreetMap is the default. Google is opt-in, server-side only, and never needed by the app. */
export function resolveProviderName(env: Env = process.env): ProviderSource {
  const raw = (env.MAPS_PROVIDER ?? '').trim().toLowerCase();
  if (raw === '') return 'osm';
  if (raw === 'osm' || raw === 'mock' || raw === 'google') return raw;
  throw new Error(`Unknown MAPS_PROVIDER "${env.MAPS_PROVIDER}". Use "osm" (default), "mock" or "google".`);
}

export function createProvider(env: Env = process.env, warn: (msg: string) => void = m => console.warn(m)): MapsProvider {
  const name = resolveProviderName(env);
  if (name === 'mock') return new MockProvider();
  if (name === 'google') {
    if (env.GOOGLE_SERVER_API_KEY) return new GoogleProvider(env.GOOGLE_SERVER_API_KEY, Number(env.MAX_GOOGLE_CALLS_PER_DAY ?? 500));
    warn('MAPS_PROVIDER=google but GOOGLE_SERVER_API_KEY is not set. Falling back to OpenStreetMap (no key needed).');
  }
  const contact = env.OSM_CONTACT?.trim();
  return new OsmProvider({
    userAgent: contact ? `${DEFAULT_USER_AGENT} contact: ${contact}` : DEFAULT_USER_AGENT,
    nominatimUrl: env.NOMINATIM_URL || undefined, osrmUrl: env.OSRM_URL || undefined, overpassUrl: env.OVERPASS_URL || undefined,
    osrmExcludeToll: env.OSRM_EXCLUDE_TOLL === 'true',
  });
}

/** Body of GET /api/health. `liveTraffic` is true only for a provider that really supplies traffic (none of the keyless ones). */
export function healthInfo(p: MapsProvider) {
  return {
    ok: true, provider: p.source,
    live: p.source !== 'mock',                 // real map data (not sample data)
    liveTraffic: p.source === 'google',        // OpenStreetMap/OSRM has no live traffic
    tollPrices: p.source === 'google',         // OpenStreetMap/OSRM has no toll prices
    attribution: p.source === 'osm' ? OSM_ATTRIBUTION : undefined,
    notice: p.source === 'osm' ? OSM_NOTICE : p.source === 'mock' ? MOCK_NOTICE : undefined,
  };
}
