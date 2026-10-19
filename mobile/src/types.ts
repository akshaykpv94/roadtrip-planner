export type StopKind = 'food' | 'fuel' | 'hotel' | 'sight' | 'rest';
// 'osm' = OpenStreetMap data, 'mock' = sample data, 'live' = an older trip saved from Google data.
export type TripSource = 'live' | 'mock' | 'osm';
export type StopStatus = 'planned' | 'visited' | 'skipped';
export interface Stop {
  id: string; kind: StopKind; name: string; address?: string;
  lat: number; lng: number;
  detourKm?: number; detourMin?: number;      // undefined = not computed yet
  rating?: number; reviews?: number;          // undefined = the data source has none (OpenStreetMap has no ratings)
  hours?: string;                              // raw OpenStreetMap opening_hours text, only when tagged
  phone?: string; mapsUri?: string; unavailable?: boolean;
  eta: string; stayMin: number; status: StopStatus;
  alternatives?: Omit<Stop, 'eta' | 'stayMin' | 'status' | 'alternatives'>[];
}
export interface Day {
  n: number; date: string; from: string; to: string;
  departs: string; arrives: string; distanceKm: number; driveMin: number;
  tollInr?: number; stops: Stop[];
}
export interface Trip {
  id: string; title: string; source: TripSource; refreshedAt?: string;
  days: Day[]; polyline: { lat: number; lng: number }[];
  warnings: string[];
  totalKm?: number; drivingMin?: number; trafficAware?: boolean;
  savedId?: string; offlineCopy?: boolean;
  req?: { from: string; to: string; departure: string; avoidTolls: boolean };
}
export interface BudgetInputs {
  mileageKmpl: number; fuelPriceInr: number; bufferPct: number;
  hotelPerNight: number; foodPerPersonDay: number; travellers: number;
  nights: number; days: number; tollInr?: number; otherInr: number;   // tollInr undefined = unknown
}
