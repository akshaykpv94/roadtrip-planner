-- Trips planned from OpenStreetMap data are saved with source = 'osm'. Run this after 001_init.sql
-- (in the Supabase SQL editor, or with `supabase db push`). Existing rows are unaffected.
alter table public.trips drop constraint if exists trips_source_check;
alter table public.trips add constraint trips_source_check check (source in ('live', 'mock', 'osm'));
