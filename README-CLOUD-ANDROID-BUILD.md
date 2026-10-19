# Highway Planner — cloud Android APK build

This repository contains the Expo mobile app (`mobile/`) and the Node/Express backend (`backend/`). `mobile/eas.json` requests an installable APK from Expo EAS Build. Maps, routing and places use free OpenStreetMap services, so **no Google Maps API key, Google Cloud project or billing account is needed**.

## Important before building

- The mobile `.env.example` uses `http://10.0.2.2:8080`, which is an Android emulator address, not a public endpoint. Deploy the backend first and set `EXPO_PUBLIC_API_URL` to its public HTTPS URL.
- If using Supabase (saved trips), configure the project URL and anon/public key in EAS environment variables as `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and run both SQL files in `supabase/migrations/`. Do not put service-role keys or any other secret in the mobile app.
- The backend defaults to OpenStreetMap (`MAPS_PROVIDER=osm`). Set `OSM_CONTACT` (an email or URL) so the public OpenStreetMap services can identify you. `MAPS_PROVIDER=mock` returns clearly labelled sample data for API testing only.
- The map screen loads Leaflet and OpenStreetMap tiles over the internet. It needs a connection and shows an error with a retry button if it cannot load. There are no offline maps.
- The free public OpenStreetMap services are for development, personal testing and modest use. They can be slow, limit requests, or be unavailable.

## Build the APK with Expo EAS

You can do this from a computer, or from a phone using GitHub Codespaces.

1. Get the code into a GitHub repository, with `mobile/` and `backend/` at the repository root. In Codespaces: Code → Codespaces → Create codespace on main.
2. In a terminal:

   ```bash
   cd mobile
   npm install
   npx eas-cli login
   npx eas-cli build:configure
   ```

   Link or create an Expo project when asked. This adds your project ID to `app.json`.
3. Set the server address for the build. In the Expo dashboard open your project → Environment variables, and add `EXPO_PUBLIC_API_URL` (your deployed HTTPS backend URL) for the `preview` environment. Add the two Supabase variables the same way if you use saved trips.
4. Build:

   ```bash
   npx eas-cli build --platform android --profile preview
   ```

   Accept the prompt to generate an Android keystore the first time.
5. When the build finishes, open the build URL EAS prints (on the phone, in Chrome) and download the APK.
6. In Android, open Downloads, tap the APK, and allow Chrome/Files to install unknown apps if asked.

## Backend deployment

Deploy `backend/` separately to a Node.js host. Build command `npm install`, start command `npm start`. Set environment variables from `backend/.env.example` (at least `OSM_CONTACT`; plus the Supabase pair for saved trips). Keep one server instance if you can: the politeness limits for the public OpenStreetMap services (request spacing and caches) are kept per process, so several instances would multiply the load on them.

## Build profile

`mobile/eas.json` defines `preview` and `production` profiles with `android.buildType: apk`, so the artifact is directly installable rather than an AAB.
