import type { LatLng } from '../lib/polyline.ts';

export type Kind = 'food' | 'fuel' | 'hotel' | 'sight' | 'rest';
/** Which data provider produced a result. 'osm' = OpenStreetMap (Nominatim + OSRM + Overpass), no API key needed. */
export type ProviderSource = 'osm' | 'mock' | 'google';
/** How a trip is labelled in the app and in saved trips. 'live' is kept for trips saved earlier from Google data. */
export type TripSource = 'live' | 'mock' | 'osm';
export const tripSourceOf = (s: ProviderSource): TripSource => (s === 'google' ? 'live' : s);

export interface RouteResult {
  distanceKm: number; durationSec: number; staticDurationSec: number;
  polyline: string; trafficAware: boolean; label?: string;
  /** Toll estimate in INR. undefined means UNKNOWN (never "zero tolls"). */
  tollInr?: number;
  /** Plain-language caveats about this specific route (for example, toll avoidance not applied). */
  notes?: string[];
}
export interface RouteReq { origin: string | LatLng; destination: string | LatLng; departure: Date; avoidTolls: boolean; alternatives: boolean }
export interface Candidate {
  id: string; name: string; address?: string; lat: number; lng: number;
  rating?: number; reviews?: number; phone?: string; mapsUri?: string;
  /** Raw OpenStreetMap `opening_hours` text, shown as-is and only when tagged. Not parsed, so never used to exclude a place. */
  openingHours?: string;
  openPeriods?: { open: { day: number; hour: number; minute: number }; close?: { day: number; hour: number; minute: number } }[];
  detourKm?: number; detourMin?: number;
}
export interface SearchReq { kind: Kind; slicePolyline: string; origin: LatLng; sliceKm: number; sliceSec: number; vegOnly?: boolean; electric?: boolean }
export interface MapsProvider {
  source: ProviderSource;
  route(req: RouteReq): Promise<RouteResult[]>;
  searchAlong(req: SearchReq): Promise<Candidate[]>;
  /** Place Details by place ID. Missing ids are simply absent from the result. */
  details?(ids: string[]): Promise<Record<string, Candidate>>;
}
export class ProviderError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
