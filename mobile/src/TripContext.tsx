import React, { createContext, useContext, useState } from 'react';
import { Trip, StopStatus } from './types';

interface Ctx { trip: Trip | null; setTrip: (t: Trip | null) => void; mark: (stopId: string, st: StopStatus) => void; }
const TripCtx = createContext<Ctx>({ trip: null, setTrip: () => {}, mark: () => {} });
export const useTrip = () => useContext(TripCtx);

// Routing, ranking and costs live in the backend; the app only renders trips and tracks visited/skipped.
export function TripProvider({ children }: { children: React.ReactNode }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const mark = (id: string, st: StopStatus) => setTrip(t => t && ({ ...t,
    days: t.days.map(d => ({ ...d, stops: d.stops.map(x => x.id === id ? { ...x, status: st } : x) })) }));
  return <TripCtx.Provider value={{ trip, setTrip, mark }}>{children}</TripCtx.Provider>;
}
