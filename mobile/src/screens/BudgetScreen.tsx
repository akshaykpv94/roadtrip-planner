import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Screen, H, Muted, Field, Banner, inr } from '../ui';
import { useTrip } from '../TripContext';
import { calcBudget } from '../budget';

export default function BudgetScreen() {
  const { trip } = useTrip();
  const [v, setV] = useState({ mileage: '15', price: '95', buffer: '10', hotel: '3000', food: '800', trav: '2' });
  if (!trip) return null;
  const km = trip.days.reduce((a, d) => a + d.distanceKm, 0);
  const b = calcBudget(km, { mileageKmpl: +v.mileage || 1, fuelPriceInr: +v.price || 0, bufferPct: +v.buffer || 0,
    hotelPerNight: +v.hotel || 0, foodPerPersonDay: +v.food || 0, travellers: +v.trav || 1,
    nights: trip.days.length - 1, days: trip.days.length,
    tollInr: trip.days.some(d => d.tollInr != null) ? trip.days.reduce((a, d) => a + (d.tollInr ?? 0), 0) : undefined, otherInr: 0 });
  const set = (k: string) => (x: string) => setV(p => ({ ...p, [k]: x }));
  const row = (l: string, n: number) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}><Text>{l}</Text><Text>{inr(n)}</Text></View>);
  return (
    <Screen>
      <ScrollView>
        <Banner tone="info" text="All amounts are estimates from your assumptions below, not live prices." />
        <H>Estimated total {inr(b.total)}</H>
        <Muted>{km} km · {b.litres.toFixed(0)} litres incl. buffer</Muted>
        <View style={{ height: 8 }} />
        {row('Fuel', b.fuel)}
        {b.toll != null ? row('Tolls (estimate)', b.toll)
          : <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}><Text>Tolls</Text><Text>Unknown, not included</Text></View>}
        {row('Stay', b.stay)}{row('Food', b.food)}
        <View style={{ height: 16 }} />
        <Field label="Mileage (km/l)" value={v.mileage} onChange={set('mileage')} keyboard="numeric" />
        <Field label="Fuel price per litre (₹, your estimate)" value={v.price} onChange={set('price')} keyboard="numeric" />
        <Field label="Buffer (%)" value={v.buffer} onChange={set('buffer')} keyboard="numeric" />
        <Field label="Hotel per night (₹)" value={v.hotel} onChange={set('hotel')} keyboard="numeric" />
        <Field label="Food per person per day (₹)" value={v.food} onChange={set('food')} keyboard="numeric" />
      </ScrollView>
    </Screen>
  );
}
