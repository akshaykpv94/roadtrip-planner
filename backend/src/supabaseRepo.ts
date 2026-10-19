import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TripRepo, TripRow } from './tripStore.ts';

/** Per-request client carrying the caller's JWT, so Postgres Row Level Security decides what they can see. */
export function clientFor(token: string): SupabaseClient {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required for saved trips');
  return createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
}

export class SupabaseRepo implements TripRepo {
  constructor(private db: SupabaseClient) {}
  async list() {
    const { data, error } = await this.db.from('trips').select('id,title,source,created_at,updated_at').order('created_at', { ascending: false }).limit(100);
    if (error) throw new Error(error.message); return data ?? [];
  }
  async get(id: string) {
    const { data, error } = await this.db.from('trips').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message); return (data as TripRow) ?? null;
  }
  async create(r: Parameters<TripRepo['create']>[0]) {
    const { data, error } = await this.db.from('trips').insert(r).select().single();
    if (error) throw new Error(error.message); return data as TripRow;
  }
  async update(id: string, r: { title: string; itinerary: any }) {
    const { data, error } = await this.db.from('trips').update(r).eq('id', id).select().maybeSingle();
    if (error) throw new Error(error.message); return (data as TripRow) ?? null;
  }
  async remove(id: string) {
    const { data, error } = await this.db.from('trips').delete().eq('id', id).select('id');
    if (error) throw new Error(error.message); return (data?.length ?? 0) > 0;
  }
}
