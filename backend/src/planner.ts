import { cumulativeKm, decode, encode, pointAtKm, sliceKm } from './lib/polyline.ts';
import { fuelStopTargets, usableRangeKm } from './lib/fuel.ts';
import { calcBudget } from './lib/budget.ts';
import { rank } from './lib/ranking.ts';
import type { Candidate, Kind, MapsProvider } from './providers/types.ts';

export interface TripRequest {
  from: string; to: string; departure: Date; days: number; travellers: number;
  fuelType: 'petrol' | 'diesel' | 'cng' | 'electric' | 'other';
  mileageKmpl: number; tankLitres: number; evRangeKm?: number; startFuelPct: number;
  maxDrivingHours: number; preferredDeparture: string; // "HH:MM" IST for days 2+
  food: 'veg' | 'nonveg' | 'both' | 'none'; hotelPerNight: number; foodPerPersonDay: number;
  fuelPriceInr: number; sightseeing: boolean; style: 'fastest' | 'balanced' | 'scenic'; avoidTolls: boolean;
  bufferPct: number;
}
export interface PlannedStop {
  id: string; kind: Kind; name: string; address?: string; lat: number; lng: number;
  detourKm?: number; detourMin?: number; rating?: number; reviews?: number; phone?: string; mapsUri?: string;
  eta: string; stayMin: number; status: 'planned'; alternatives: Candidate[];
}
const STAY: Record<Kind, number> = { food: 40, fuel: 10, hotel: 0, sight: 45, rest: 15 };
const MAX_DETOUR: Record<Kind, number> = { food: 12, fuel: 8, hotel: 20, sight: 20, rest: 8 };
const fmt = (d: Date) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata', hour12: false }).format(d);
const dayLabel = (d: Date) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(d);

/** Minutes after IST midnight for a Date. */
const istMin = (d: Date) => { const x = new Date(d.getTime() + 5.5 * 3600_000); return x.getUTCHours() * 60 + x.getUTCMinutes(); };

export function daysNeeded(durationSec: number, maxHours: number, requested: number) {
  const needed = Math.max(1, Math.ceil(durationSec / (maxHours * 3600)));
  return { days: Math.max(needed, requested), needed, requestedTooShort: requested < needed };
}

interface Want { kind: Kind; km: number; maxDetour: number }

export async function planTrip(req: TripRequest, provider: MapsProvider) {
  const [main, ...alts] = await provider.route({ origin: req.from, destination: req.to, departure: req.departure, avoidTolls: req.avoidTolls, alternatives: true });
  const pts = decode(main.polyline), cum = cumulativeKm(pts), polyKm = cum.at(-1)!;
  const kmScale = main.distanceKm / polyKm;            // polyline length -> Google distance
  const totalKm = main.distanceKm, secPerKm = main.durationSec / totalKm;
  const { days, needed, requestedTooShort } = daysNeeded(main.durationSec, req.maxDrivingHours, req.days);
  const warnings: string[] = [];
  if (provider.source === 'mock') warnings.push('MOCK DATA: no Google credentials in use. Do not rely on this itinerary.');
  if (!main.trafficAware) warnings.push('Traffic-aware timing is unavailable; durations are free-flow estimates.');
  if (requestedTooShort) warnings.push(`This route needs at least ${needed} days at ${req.maxDrivingHours} driving hours a day; the plan uses ${days}.`);

  // Fuel/charge stop positions over the whole trip (km from start).
  const electric = req.fuelType === 'electric';
  const range = electric ? (req.evRangeKm ?? 0) * 0.75 : usableRangeKm(req.tankLitres, req.mileageKmpl);
  const fuelAt = range > 0 ? fuelStopTargets(totalKm, range, req.startFuelPct / 100) : [];
  if (range <= 0) warnings.push('Add vehicle range or tank size to get refuel suggestions.');

  const dayKm = totalKm / days, outDays = [];
  let overnightFrom = req.from, dep = req.departure;
  for (let n = 1; n <= days; n++) {
    const start = (n - 1) * dayKm, end = n * dayKm, last = n === days;
    if (n > 1) { // next morning at preferred departure, IST
      const [h, m] = req.preferredDeparture.split(':').map(Number);
      const d = new Date(dep.getTime()); const delta = (h * 60 + m) - istMin(d);
      dep = new Date(d.getTime() + (delta + 1440) * 60_000);
    }
    // Desired stops by position. Meal times are placed by clock time at free-flow pace (stays shift real ETAs later).
    const wants: Want[] = fuelAt.filter(k => k > start && k <= end).map(k => ({ kind: 'fuel' as Kind, km: k, maxDetour: MAX_DETOUR.fuel }));
    const meals: [number, Kind][] = [[8 * 60 + 30, 'food'], [13 * 60, 'food'], [16 * 60 + 30, 'rest'], [20 * 60, 'food']];
    const dayEndMin = istMin(dep) + ((end - start) * secPerKm) / 60;
    for (const [clock, kind] of meals) {
      if (req.style === 'fastest' && clock !== 13 * 60 && clock !== 20 * 60) continue;
      const k = start + ((clock - istMin(dep)) * 60) / secPerKm;
      if (clock > istMin(dep) + 20 && clock < dayEndMin - 20 && k > start && k < end) wants.push({ kind, km: k, maxDetour: MAX_DETOUR[kind] });
    }
    if (req.sightseeing) wants.push({ kind: 'sight', km: start + (end - start) * 0.55, maxDetour: req.style === 'scenic' ? 20 : 10 });
    if (!last) wants.push({ kind: 'hotel', km: end, maxDetour: MAX_DETOUR.hotel });
    wants.sort((a, b) => a.km - b.km);

    // Resolve each want against Places data and compute ETAs.
    let t = dep, pos = start; const stops: PlannedStop[] = [];
    for (const w of wants) {
      const from = (w.kind === 'hotel' ? w.km - 40 : w.km - 15) / kmScale, to = (w.kind === 'hotel' ? w.km + 5 : w.km + 15) / kmScale;
      const slice = sliceKm(pts, cum, from, to);
      const sKm = (cumulativeKm(slice).at(-1) ?? 0) * kmScale;
      let cands: Candidate[] = [];
      try {
        cands = await provider.searchAlong({ kind: w.kind, slicePolyline: encode(slice), origin: slice[0], sliceKm: sKm, sliceSec: sKm * secPerKm,
          vegOnly: req.food === 'veg', electric });
      } catch (e) { warnings.push(`Could not load ${w.kind} options near km ${Math.round(w.km)}: ${(e as Error).message}`); continue; }
      const arrive = new Date(t.getTime() + (w.km - pos) * secPerKm * 1000);
      const ranked = rank(cands, { maxDetourMin: w.maxDetour, arriveAt: arrive });
      if (!ranked.length) { warnings.push(`No suitable ${w.kind} stop found near km ${Math.round(w.km)}.`); continue; }
      const [best, ...rest] = ranked, stay = STAY[w.kind], detour = best.detourMin ?? 0;
      stops.push({ id: best.id, kind: w.kind, name: best.name, address: best.address, lat: best.lat, lng: best.lng, detourKm: best.detourKm,
        detourMin: best.detourMin, rating: best.rating, reviews: best.reviews, phone: best.phone, mapsUri: best.mapsUri,
        eta: fmt(new Date(arrive.getTime() + (detour / 2) * 60_000)), stayMin: stay, status: 'planned', alternatives: rest.slice(0, 2) });
      t = new Date(arrive.getTime() + (stay + detour) * 60_000); pos = w.km;
    }
    const arrives = new Date(t.getTime() + (end - pos) * secPerKm * 1000);
    const driveMin = Math.round(((end - start) * secPerKm) / 60);
    if (driveMin > 600) warnings.push(`Day ${n} has ${(driveMin / 60).toFixed(1)} hours of driving. Consider adding a day.`);
    if (istMin(arrives) > 21 * 60 || istMin(arrives) < 5 * 60) warnings.push(`Day ${n} arrival is about ${fmt(arrives)}. Plan for late or night driving carefully.`);
    const hotel = stops.find(s => s.kind === 'hotel');
    outDays.push({ n, date: dayLabel(dep), from: overnightFrom, to: last ? req.to : (hotel?.name ?? 'Overnight stop (no hotel found)'),
      departs: fmt(dep), arrives: fmt(arrives), distanceKm: Math.round(end - start), driveMin,
      tollInr: main.tollInr != null ? Math.round((main.tollInr * (end - start)) / totalKm) : undefined, stops });
    overnightFrom = hotel?.name ?? 'Overnight stop'; dep = arrives;
  }

  const budget = calcBudget({ distanceKm: totalKm, mileageKmpl: req.mileageKmpl, fuelPriceInr: req.fuelPriceInr, bufferPct: req.bufferPct,
    nights: days - 1, hotelPerNight: req.hotelPerNight, days, travellers: req.travellers, foodPerPersonDay: req.foodPerPersonDay, tollInr: main.tollInr });
  const step = Math.max(1, Math.floor(pts.length / 300));
  return {
    id: `trip-${Date.now()}`, title: `${req.from} to ${req.to}`, source: provider.source === 'google' ? 'live' : 'mock',
    refreshedAt: new Date().toISOString(), trafficAware: main.trafficAware,
    totalKm: Math.round(totalKm), drivingMin: Math.round(main.durationSec / 60), days: outDays, budget, warnings,
    polyline: pts.filter((_, i) => i % step === 0 || i === pts.length - 1),
    alternatives: alts.map(a => ({ label: a.label, distanceKm: Math.round(a.distanceKm), durationMin: Math.round(a.durationSec / 60), tollInr: a.tollInr })),
  };
}

/** Traffic refresh: compares current traffic-aware duration to the original plan. A predicted delay is not an incident report. */
export async function refreshEta(args: { from: string; to: string; originalDurationMin: number; departure: Date; avoidTolls: boolean }, provider: MapsProvider) {
  const routes = await provider.route({ origin: args.from, destination: args.to, departure: args.departure, avoidTolls: args.avoidTolls, alternatives: true });
  const [cur, ...alts] = routes, curMin = Math.round(cur.durationSec / 60), delta = curMin - args.originalDurationMin;
  const better = alts.map(a => ({ label: a.label, durationMin: Math.round(a.durationSec / 60), distanceKm: Math.round(a.distanceKm) }))
    .filter(a => curMin - a.durationMin >= 10);
  return { refreshedAt: new Date().toISOString(), trafficAware: cur.trafficAware, durationMin: curMin, deltaMin: delta,
    significantDelay: delta >= Math.max(15, args.originalDurationMin * 0.1), betterAlternatives: better,
    note: cur.trafficAware ? 'Predicted from traffic data; this is not a report of closures or incidents.' : 'Traffic data unavailable for this refresh.' };
}
void pointAtKm;
