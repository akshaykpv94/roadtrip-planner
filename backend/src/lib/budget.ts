export interface BudgetIn {
  distanceKm: number; mileageKmpl: number; fuelPriceInr: number; bufferPct: number;
  nights: number; hotelPerNight: number; days: number; travellers: number; foodPerPersonDay: number;
  tollInr?: number; otherInr?: number;
}
export interface Line { amountInr: number; basis: 'estimate' | 'google-estimate' | 'unknown'; note: string }

export function calcBudget(b: BudgetIn) {
  const litres = (b.distanceKm / b.mileageKmpl) * (1 + b.bufferPct / 100);
  const lines: Record<string, Line> = {
    fuel: { amountInr: litres * b.fuelPriceInr, basis: 'estimate', note: 'Uses your fuel price per litre, not a live price.' },
    toll: b.tollInr == null
      ? { amountInr: 0, basis: 'unknown', note: 'No toll estimate returned for this route.' }
      : { amountInr: b.tollInr, basis: 'google-estimate', note: 'Estimate from the Routes API; actual FASTag charges may differ.' },
    stay: { amountInr: b.nights * b.hotelPerNight, basis: 'estimate', note: 'Your nightly budget; no room rates or availability checked.' },
    food: { amountInr: b.days * b.travellers * b.foodPerPersonDay, basis: 'estimate', note: 'Your per-person daily budget.' },
    other: { amountInr: b.otherInr ?? 0, basis: 'estimate', note: 'User-entered.' },
  };
  const total = Object.values(lines).reduce((a, l) => a + l.amountInr, 0);
  return { litres, lines, totalInr: total };
}
