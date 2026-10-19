# Highway Planner — cloud Android APK build

This bundle contains the existing Expo mobile app (`mobile/`) and Node/Express backend (`backend/`). It adds an EAS Build configuration that requests an installable APK. It has not been built or device-tested yet.

## Important before building

- The mobile `.env.example` uses `http://10.0.2.2:8080`, which is an Android emulator address, not a public endpoint. Deploy the backend first and set `EXPO_PUBLIC_API_URL` to its public HTTPS URL.
- Set a valid restricted Google Maps Android key in `mobile/app.json` for map tiles. The current value is a placeholder.
- If using Supabase, configure the project URL and anon/public key in EAS environment variables. Do not put server-side Google API keys or Supabase service-role keys in the mobile app.
- The backend defaults to `MAPS_PROVIDER=mock`; live Google Routes/Places needs a server-side key and enabled APIs/billing.

## Build from a phone using GitHub Codespaces

1. Create a private GitHub repository in Chrome on your phone.
2. Upload the contents of this bundle to the repository. Keep `mobile/` and `backend/` at the repository root.
3. Open the repository in a Codespace (Code → Codespaces → Create codespace on main).
4. In the Codespaces terminal:

   ```bash
   cd mobile
   npm install
   npx eas-cli login
   npx eas-cli build:configure
   npx eas-cli build --platform android --profile preview
   ```

5. Follow the prompts to link/create an Expo project and generate Android signing credentials when asked. When the build finishes, open the EAS build URL in Chrome and download the APK to your phone.
6. In Android, open Downloads, tap the APK, and allow Chrome/Files to install unknown apps if Android asks.

## Backend deployment

Deploy `backend/` separately to a Node.js hosting service. Set its start command to `npm start`, build command to `npm install`, and environment variables from `backend/.env.example`. Initially `MAPS_PROVIDER=mock` can be used for basic API testing. Set the mobile `EXPO_PUBLIC_API_URL` to the deployed HTTPS API URL in EAS environment variables before building, then rebuild.

## Build profile

`mobile/eas.json` defines `preview` and `production` profiles with `android.buildType: apk`, so the build artifact is directly installable rather than an AAB. A successful build is not guaranteed until dependency/configuration checks pass.
