import type { LatLng } from '../lib/polyline.ts';

export type Kind = 'food' | 'fuel' | 'hotel' | 'sight' | 'rest';
export interface RouteResult {
  distanceKm: number; durationSec: number; staticDurationSec: number;
  polyline: string; tollInr?: number; trafficAware: boolean; label?: string;
}
export interface RouteReq { origin: string | LatLng; destination: string | LatLng; departure: Date; avoidTolls: boolean; alternatives: boolean }
export interface Candidate {
  id: string; name: string; address?: string; lat: number; lng: number;
  rating?: number; reviews?: number; phone?: string; mapsUri?: string;
  openPeriods?: { open: { day: number; hour: number; minute: number }; close?: { day: number; hour: number; minute: number } }[];
  detourKm?: number; detourMin?: number;
}
export interface SearchReq { kind: Kind; slicePolyline: string; origin: LatLng; sliceKm: number; sliceSec: number; vegOnly?: boolean; electric?: boolean }
export interface MapsProvider {
  source: 'google' | 'mock';
  route(req: RouteReq): Promise<RouteResult[]>;
  searchAlong(req: SearchReq): Promise<Candidate[]>;
  /** Place Details by place ID. Missing ids are simply absent from the result. */
  details?(ids: string[]): Promise<Record<string, Candidate>>;
}
export class ProviderError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
