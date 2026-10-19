# Supabase setup (saved trips)

1. Create a project at supabase.com.
2. Authentication → Sign In / Providers → turn on **Anonymous sign-ins**. Turn on CAPTCHA or Turnstile before public release (Supabase recommends it to stop abuse).
3. SQL editor → run `supabase/migrations/001_init.sql`, then `supabase/migrations/002_allow_osm_source.sql`. Without the second file, saving a trip planned from OpenStreetMap data is rejected by the database.
4. Backend `.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (anon/publishable key only).
5. App `.env`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

Anonymous accounts live on one phone. Reinstalling loses access to them, so add email or Google sign-in (link the anonymous user) before launch.
