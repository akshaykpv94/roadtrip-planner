-- Highway Planner schema. Run in the Supabase SQL editor or with `supabase db push`.
-- Row Level Security is the access control: the API calls Supabase with the user's own JWT.

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  source text not null check (source in ('live', 'mock')),
  request jsonb not null,            -- from, to, departure, avoidTolls (our own inputs)
  itinerary jsonb not null,          -- days and stops; Google place content is stripped, see backend/src/tripStore.ts
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint itinerary_size check (pg_column_size(itinerary) < 400000)
);
create index trips_user_created_idx on public.trips (user_id, created_at desc);

create table public.user_preferences (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Places the user adds themselves (their own data, not Google content).
create table public.user_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  kind text not null check (kind in ('food', 'fuel', 'hotel', 'sight', 'rest')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  note text,
  created_at timestamptz not null default now()
);
create index user_places_user_idx on public.user_places (user_id);

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger trips_touch before update on public.trips for each row execute function public.touch_updated_at();
create trigger prefs_touch before update on public.user_preferences for each row execute function public.touch_updated_at();

alter table public.trips enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_places enable row level security;

create policy trips_own on public.trips for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy prefs_own on public.user_preferences for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy places_own on public.user_places for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
