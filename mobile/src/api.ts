import { Trip } from './types';
import { accessToken, savingConfigured } from './supabase';
import { SavedSummary } from './offline';

// Android emulator reaches your computer at 10.0.2.2. On a real phone set EXPO_PUBLIC_API_URL to your computer's LAN IP or hosted URL.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8080';

export class ApiError extends Error {
  constructor(message: string, public kind: 'offline' | 'invalid' | 'server') { super(message); }
}

async function call<T>(path: string, body?: unknown, opts: { method?: string; auth?: boolean } = {}): Promise<T> {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 60_000); // generation makes several Google calls
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.auth) {
      if (!savingConfigured) throw new ApiError('Saving is not set up. Add the Supabase address and key to the app settings.', 'invalid');
      const token = await accessToken();
      if (!token) throw new ApiError('Could not sign in to save trips. Check your connection.', 'offline');
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(API_URL + path, { method: opts.method ?? (body ? 'POST' : 'GET'), signal: ctl.signal, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 204) return undefined as T;
    const json = await res.json().catch(() => ({}));
    if (res.status === 404) throw new ApiError(json.error ?? 'Not found.', 'invalid');
    if (res.status === 400) throw new ApiError((json.issues?.[0] ? `${json.issues[0].path.join('.')}: ${json.issues[0].message}` : json.error) ?? 'Check your trip details.', 'invalid');
    if (!res.ok) throw new ApiError(json.error ?? `Server error (${res.status}).`, 'server');
    return json as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('Cannot reach the planning server. Check your connection and the server address in Settings.', 'offline');
  } finally { clearTimeout(timer); }
}

export interface TripForm {
  from: string; to: string; date: string; time: string; days: number; travellers: number; fuelType: string;
  mileageKmpl: number; tankLitres: number; maxDrivingHours: number; food: string; hotelPerNight: number;
  foodPerPersonDay: number; style: string; avoidTolls: boolean;
}

const foodMap: Record<string, string> = { 'Veg': 'veg', 'Non-veg': 'nonveg', 'Both': 'both', 'No preference': 'none' };
const styleMap: Record<string, string> = { Fastest: 'fastest', Balanced: 'balanced', Scenic: 'scenic' };

export function departureIso(date: string, time: string): string {
  return `${date}T${time}:00+05:30`; // India Standard Time
}

export async function generateTrip(f: TripForm): Promise<Trip> {
  const departure = departureIso(f.date, f.time);
  const trip = await call<Trip>('/api/trips/generate', {
    from: f.from.trim(), to: f.to.trim(), departure, days: f.days, travellers: f.travellers,
    fuelType: f.fuelType.toLowerCase(), mileageKmpl: f.mileageKmpl, tankLitres: f.tankLitres,
    maxDrivingHours: f.maxDrivingHours, preferredDeparture: f.time, food: foodMap[f.food] ?? 'none',
    hotelPerNight: f.hotelPerNight, foodPerPersonDay: f.foodPerPersonDay, style: styleMap[f.style] ?? 'balanced',
    avoidTolls: f.avoidTolls, sightseeing: false,
    ...(f.fuelType === 'Electric' ? { evRangeKm: f.tankLitres } : {}), // for EVs the "tank" field is treated as range in km
  });
  return { ...trip, req: { from: f.from.trim(), to: f.to.trim(), departure, avoidTolls: f.avoidTolls } };
}

export interface RefreshResult {
  refreshedAt: string; trafficAware: boolean; durationMin: number; deltaMin: number;
  significantDelay: boolean; betterAlternatives: { label?: string; durationMin: number; distanceKm: number }[]; note: string;
}
export const refreshTrip = (t: Trip) => call<RefreshResult>('/api/trips/refresh', {
  ...t.req, originalDurationMin: t.drivingMin, departure: new Date().toISOString() });

export const health = () => call<{ ok: boolean; provider: 'google' | 'mock'; live: boolean }>('/api/health');

export const listSaved = () => call<SavedSummary[]>('/api/saved', undefined, { auth: true });
export const loadSaved = (id: string) => call<Trip>(`/api/saved/${id}`, undefined, { auth: true });
export const createSaved = (t: Trip) => call<{ id: string }>('/api/saved', { trip: t }, { auth: true });
export const updateSaved = (t: Trip) => call<{ id: string }>(`/api/saved/${t.savedId}`, { trip: t }, { auth: true, method: 'PUT' });
export const deleteSaved = (id: string) => call<void>(`/api/saved/${id}`, undefined, { auth: true, method: 'DELETE' });
