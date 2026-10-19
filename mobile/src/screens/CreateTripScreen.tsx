import React, { useState } from 'react';
import { ScrollView, View, Text, Switch, ActivityIndicator } from 'react-native';
import { Screen, Field, Chips, Button, Banner } from '../ui';
import { useTrip } from '../TripContext';
import { generateTrip, ApiError } from '../api';
import { c } from '../theme';

const tomorrow = () => new Date(Date.now() + 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10);

export default function CreateTripScreen({ navigation }: any) {
  const { setTrip } = useTrip();
  const [f, setF] = useState({ from: '', to: '', date: tomorrow(), time: '06:00', days: '2', travellers: '2',
    fuel: 'Diesel', mileage: '15', tank: '45', maxHours: '9', food: 'No preference', hotel: '3000',
    foodBudget: '800', style: 'Balanced', noToll: false });
  const [err, setErr] = useState<{ text: string; retry: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (v: any) => setF(p => ({ ...p, [k]: v }));

  const submit = async () => {
    const days = Number(f.days), mileage = Number(f.mileage), tank = Number(f.tank), maxHours = Number(f.maxHours);
    if (f.from.trim().length < 2 || f.to.trim().length < 2) return setErr({ text: 'Enter both a start and a destination.', retry: false });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return setErr({ text: 'Enter the date as YYYY-MM-DD.', retry: false });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time)) return setErr({ text: 'Enter the time as HH:MM, 24-hour.', retry: false });
    if (![days, mileage, tank, maxHours].every(n => n > 0)) return setErr({ text: 'Days, mileage, tank size and driving hours must be positive.', retry: false });
    setErr(null); setBusy(true);
    try {
      const trip = await generateTrip({ from: f.from, to: f.to, date: f.date, time: f.time, days, travellers: Number(f.travellers) || 1,
        fuelType: f.fuel, mileageKmpl: mileage, tankLitres: tank, maxDrivingHours: maxHours, food: f.food,
        hotelPerNight: Number(f.hotel) || 0, foodPerPersonDay: Number(f.foodBudget) || 0, style: f.style, avoidTolls: f.noToll });
      setTrip(trip);
      navigation.replace('Itinerary');
    } catch (e) {
      const a = e as ApiError;
      setErr({ text: a.message, retry: a.kind !== 'invalid' });
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        {err && <Banner tone="warn" text={err.text} />}
        <Field label="Starting from" value={f.from} onChange={set('from')} />
        <Field label="Destination" value={f.to} onChange={set('to')} />
        <Field label="Departure date" value={f.date} onChange={set('date')} hint="YYYY-MM-DD, India time" />
        <Field label="Departure time" value={f.time} onChange={set('time')} hint="24-hour, e.g. 06:00. Also used for later mornings." />
        <Field label="Travel days" value={f.days} onChange={set('days')} keyboard="numeric" />
        <Field label="Travellers" value={f.travellers} onChange={set('travellers')} keyboard="numeric" />
        <Text style={{ fontWeight: '600', marginBottom: 4 }}>Fuel type</Text>
        <Chips options={['Petrol', 'Diesel', 'CNG', 'Electric']} value={f.fuel} onChange={set('fuel')} />
        <Field label="Mileage (km per litre)" value={f.mileage} onChange={set('mileage')} keyboard="numeric" />
        <Field label={f.fuel === 'Electric' ? 'Full-charge range (km)' : 'Tank size (litres)'} value={f.tank} onChange={set('tank')} keyboard="numeric" />
        <Field label="Max driving hours per day" value={f.maxHours} onChange={set('maxHours')} keyboard="numeric" hint="Over 10 hours triggers a fatigue warning." />
        <Text style={{ fontWeight: '600', marginBottom: 4 }}>Food preference</Text>
        <Chips options={['Veg', 'Non-veg', 'Both', 'No preference']} value={f.food} onChange={set('food')} />
        <Field label="Hotel budget per night (₹)" value={f.hotel} onChange={set('hotel')} keyboard="numeric" />
        <Field label="Food budget per person per day (₹)" value={f.foodBudget} onChange={set('foodBudget')} keyboard="numeric" />
        <Text style={{ fontWeight: '600', marginBottom: 4 }}>Travel style</Text>
        <Chips options={['Fastest', 'Balanced', 'Scenic']} value={f.style} onChange={set('style')} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontSize: 16 }}>Avoid tolls</Text>
          <Switch value={f.noToll} onValueChange={set('noToll')} />
        </View>
        {busy ? (
          <View style={{ alignItems: 'center', padding: 16 }}>
            <ActivityIndicator color={c.board} size="large" />
            <Text style={{ marginTop: 8, color: c.muted }}>Planning your route and stops. This can take up to a minute.</Text>
          </View>
        ) : <Button label={err?.retry ? 'Try again' : 'Generate itinerary'} onPress={submit} />}
        <View style={{ height: 32 }} />
      </ScrollView>
    </Screen>
  );
}
