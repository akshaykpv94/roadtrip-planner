import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL, key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const savingConfigured = Boolean(url && key);
const supabase = savingConfigured
  ? createClient(url!, key!, { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } })
  : null;

/** Returns a valid access token, creating an anonymous account on first use (enable Anonymous sign-ins in Supabase). */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.access_token;
  const r = await supabase.auth.signInAnonymously();
  return r.data.session?.access_token ?? null;
}
