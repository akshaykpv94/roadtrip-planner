/** Fuel required = planned distance / assumed mileage, plus a configurable buffer. */
export function fuelRequiredLitres(distanceKm: number, mileageKmpl: number, bufferPct = 10): number {
  if (!(mileageKmpl > 0)) throw new Error('mileage must be positive');
  return (distanceKm / mileageKmpl) * (1 + bufferPct / 100);
}

/** Range on a full tank after keeping a reserve (default 25%). */
export function usableRangeKm(tankLitres: number, mileageKmpl: number, reservePct = 25): number {
  return tankLitres * mileageKmpl * (1 - reservePct / 100);
}

/**
 * Route positions (km from trip start) where a refuel should happen.
 * A stop is placed at 75% of the remaining usable range so there is slack to find a pump in rural stretches.
 */
export function fuelStopTargets(totalKm: number, rangeKm: number, startFuelFraction = 1): number[] {
  if (!(rangeKm > 0)) throw new Error('range must be positive');
  const out: number[] = []; let pos = 0, remaining = rangeKm * Math.min(1, Math.max(0, startFuelFraction));
  while (totalKm - pos > remaining * 0.9) {
    const next = pos + Math.max(remaining * 0.75, 1);
    if (next >= totalKm) break;
    out.push(next); pos = next; remaining = rangeKm;
  }
  return out;
}
