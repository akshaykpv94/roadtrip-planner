import { BudgetInputs } from './types';
// Fuel litres = distance / mileage; buffer applied to fuel only. All values are estimates.
// toll is undefined when unknown (never treated as zero) and is then left out of the total.
export function calcBudget(distanceKm: number, b: BudgetInputs) {
  const litres = (distanceKm / b.mileageKmpl) * (1 + b.bufferPct / 100);
  const fuel = litres * b.fuelPriceInr;
  const stay = b.hotelPerNight * b.nights;
  const food = b.foodPerPersonDay * b.travellers * b.days;
  return { litres, fuel, stay, food, toll: b.tollInr, other: b.otherInr,
    total: fuel + stay + food + (b.tollInr ?? 0) + b.otherInr };
}
