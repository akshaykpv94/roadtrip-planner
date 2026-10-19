# Highway Planner

Plan an Indian road trip: route, day-by-day itinerary, petrol/EV charging, food, hotel and sightseeing stops, and a budget. Expo React Native Android app (`mobile/`) with a Node.js/Express TypeScript backend (`backend/`).

**It runs on free OpenStreetMap services. No Google Cloud project, Google Maps API key, billing account or other paid or secret map key is needed.**

| Job | Service | Endpoint |
| --- | --- | --- |
| Map tiles | OpenStreetMap | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (shown with Leaflet in a WebView) |
| Road route, distance, duration | OSRM | `https://router.project-osrm.org/route/v1/driving/` |
| Place name to coordinates | Nominatim | `https://nominatim.openstreetmap.org/search` |
| Petrol, EV charging, food, hotels, rest stops, sights | Overpass API | `https://overpass-api.de/api/interpreter` |

Map data © OpenStreetMap contributors (ODbL). The app shows this attribution on the map and in Settings.

## What this data can and cannot do

Be clear with users about these limits; the app and the API say them too.

- **No live traffic.** Durations are free-flow estimates from road data and are often optimistic. "Refresh" cannot detect delays.
- **No toll prices.** Tolls are shown as unknown and are left out of the budget total, never shown as zero. "Avoid tolls" cannot be applied on the public OSRM server, so routes may include tolls (the app says so).
- **No ratings or reviews, and opening hours only if someone tagged them** in OpenStreetMap (shown as raw text, "may be out of date"). Phone numbers and addresses likewise only when tagged. Many places have no name; they show as "Unnamed ...".
- **One route, no alternatives.** Nothing is invented to fill the gap.
- **Detours are approximate:** straight-line distance from the route, not a routed detour.
- **Veg-only** food is best effort: places explicitly tagged non-vegetarian are excluded, but many places carry no diet tag.
- **The map needs an internet connection.** There are no offline tiles. Saved trips can still be opened offline, but not their map.

## Free public services are not production infrastructure

Nominatim, the OSRM demo server and Overpass are shared, volunteer-run services. Use them for development, personal testing and modest usage under their usage policies. They can throttle, block or go away without notice. The backend is built to be a polite client:

- Nominatim: sequential requests, at least 1.1 s apart globally, successful lookups cached for 7 days, only the two trip endpoints are geocoded (never one request per stop), and an identifying `User-Agent`. **Set `OSM_CONTACT`** to your email or website.
- OSRM demo: spaced at least 1.1 s apart; routes cached for 30 minutes; identical simultaneous requests are shared.
- Overpass: one bounded corridor query per stop slice (never a state or country), spaced at least 1 s apart, cached for 6 hours, queries over 120 km of road are refused.
- Everywhere: request timeouts, response validation, and retries with exponential backoff only for network errors, timeouts, HTTP 429 and 5xx (a long `Retry-After` is reported instead of waited out). The app does no background polling.

Generating one trip makes a couple of dozen spaced requests, so it takes up to about a minute. For heavier use, host your own Nominatim/OSRM/Overpass and set `NOMINATIM_URL`, `OSRM_URL` and `OVERPASS_URL`.

## Run the backend

```bash
cd backend
npm install
cp .env.example .env      # set OSM_CONTACT; Supabase values only if you want saved trips
npm run dev               # http://localhost:8080, uses OpenStreetMap by default
```

`GET /api/health` reports the provider (`osm`), `liveTraffic: false` and `tollPrices: false`.

`MAPS_PROVIDER` selects the data source:

- `osm` (default if unset): OpenStreetMap, as above. Trips are labelled `osm`.
- `mock`: sample data for tests and offline development. Labelled `mock` and flagged in the app. Not real routes. Use `MAPS_PROVIDER=mock npm run dev`.
- `google` (optional, server-side only, not needed by the app): needs `GOOGLE_SERVER_API_KEY`. If the key is missing the server logs a warning and uses OpenStreetMap instead of failing to start.

An unknown value fails at startup so a typo is never silently ignored.

### Tests and type checks

```bash
cd backend && npm test && npm run typecheck      # no test touches the network (HTTP is mocked)
cd ../mobile && npm install && npx tsc --noEmit
```

## Run the app

```bash
cd mobile
npm install
cp .env.example .env      # EXPO_PUBLIC_API_URL: emulator 10.0.2.2:8080, or your computer's LAN IP / deployed HTTPS URL
npx expo start --android
```

Settings shows the API status: OpenStreetMap/OSRM mode, mock/demo mode, or server unavailable.

## Saved trips (Supabase)

See `docs/SUPABASE.md`. Run both migrations in `supabase/migrations/` (the second one allows trips planned from OpenStreetMap data to be saved).

## Build an installable Android APK

See `README-CLOUD-ANDROID-BUILD.md`.
