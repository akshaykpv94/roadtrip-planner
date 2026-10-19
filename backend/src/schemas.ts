import { z } from 'zod';
import type { TripRequest } from './planner.ts';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, 24-hour');
export const tripSchema = z.object({
  from: z.string().trim().min(2).max(200), to: z.string().trim().min(2).max(200),
  departure: z.coerce.date(), days: z.number().int().min(1).max(14).default(2),
  travellers: z.number().int().min(1).max(20).default(2),
  fuelType: z.enum(['petrol', 'diesel', 'cng', 'electric', 'other']).default('diesel'),
  mileageKmpl: z.number().positive().max(100).default(15), tankLitres: z.number().positive().max(200).default(45),
  evRangeKm: z.number().positive().max(1500).optional(), startFuelPct: z.number().min(0).max(100).default(100),
  maxDrivingHours: z.number().min(2).max(14).default(9), preferredDeparture: hhmm.default('07:00'),
  food: z.enum(['veg', 'nonveg', 'both', 'none']).default('none'),
  hotelPerNight: z.number().min(0).default(3000), foodPerPersonDay: z.number().min(0).default(800),
  fuelPriceInr: z.number().positive().default(95), sightseeing: z.boolean().default(false),
  style: z.enum(['fastest', 'balanced', 'scenic']).default('balanced'), avoidTolls: z.boolean().default(false),
  bufferPct: z.number().min(0).max(50).default(10),
}).refine(v => v.fuelType !== 'electric' || v.evRangeKm != null, { message: 'evRangeKm is required for electric vehicles', path: ['evRangeKm'] });

export const refreshSchema = z.object({
  from: z.string().min(2), to: z.string().min(2), originalDurationMin: z.number().positive(),
  departure: z.coerce.date(), avoidTolls: z.boolean().default(false),
});
export type Parsed = z.infer<typeof tripSchema> & TripRequest;
