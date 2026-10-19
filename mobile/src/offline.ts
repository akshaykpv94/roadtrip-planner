import AsyncStorage from '@react-native-async-storage/async-storage';
import { Trip } from './types';

// Device-only copies so a saved trip can still be opened with no signal. Shown with an "offline copy" notice.
export interface SavedSummary { id: string; title: string; source: 'live' | 'mock'; created_at: string; updated_at: string }
const read = async <T,>(k: string): Promise<T | null> => { try { const v = await AsyncStorage.getItem(k); return v ? JSON.parse(v) as T : null; } catch { return null; } };
const write = async (k: string, v: unknown) => { try { await AsyncStorage.setItem(k, JSON.stringify(v)); } catch { /* cache is best-effort */ } };

export const cacheList = (l: SavedSummary[]) => write('saved:list', l);
export const readList = async () => (await read<SavedSummary[]>('saved:list')) ?? [];
export const cacheTrip = (t: Trip) => t.savedId ? write(`saved:trip:${t.savedId}`, t) : Promise.resolve();
export const readTrip = (id: string) => read<Trip>(`saved:trip:${id}`);
export const dropTrip = async (id: string) => { try { await AsyncStorage.removeItem(`saved:trip:${id}`); } catch { /* ignore */ } };
