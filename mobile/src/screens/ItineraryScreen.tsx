import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Screen, H, Muted, Card, Button, Banner, hm, inr } from '../ui';
import { useTrip } from '../TripContext';
import { c } from '../theme';
import { StopKind } from '../types';
import { refreshTrip, RefreshResult, ApiError, createSaved, updateSaved } from '../api';
import { cacheTrip } from '../offline';

const label: Record<StopKind, string> = { food: 'Food', fuel: 'Petrol', hotel: 'Hotel', sight: 'Sightseeing', rest: 'Tea break' };

export default function ItineraryScreen({ navigation }: any) {
  const { trip, setTrip } = useTrip();
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ tone: 'warn' | 'info'; text: string } | null>(null);
  const save = async () => {
    if (!trip) return; setSaving(true); setSaveMsg(null);
    try {
      const id = trip.savedId ? (await updateSaved(trip), trip.savedId) : (await createSaved(trip)).id;
      const t = { ...trip, savedId: id, offlineCopy: false }; setTrip(t); await cacheTrip(t);
      setSaveMsg({ tone: 'info', text: 'Trip saved.' });
    } catch (e) { setSaveMsg({ tone: 'warn', text: `${(e as ApiError).message} Your changes are not saved yet.` }); }
    finally { setSaving(false); }
  };
  const [rf, setRf] = useState<RefreshResult | null>(null);
  const [rfErr, setRfErr] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => { if (!trip) return; setBusy(true); setRfErr(''); try { setRf(await refreshTrip(trip)); } catch (e) { setRfErr((e as ApiError).message); } finally { setBusy(false); } };
  if (!trip) return <Screen><Banner tone="info" text="No itinerary yet. Plan a trip first." /></Screen>;
  return (
    <Screen>
      <ScrollView>
        {trip.warnings.map(w => <Banner key={w} tone="warn" text={w} />)}
        {trip.offlineCopy && <Banner tone="warn" text="Offline copy from this phone. Place details and times may be out of date." />}
        {saveMsg && <Banner tone={saveMsg.tone} text={saveMsg.text} />}
        {rfErr ? <Banner tone="warn" text={rfErr} /> : null}
        {rf && (
          <Banner tone={rf.significantDelay ? 'warn' : 'info'}
            text={`${rf.deltaMin > 0 ? `About ${rf.deltaMin} min slower` : rf.deltaMin < 0 ? `About ${-rf.deltaMin} min faster` : 'No change'} than planned. ${rf.note}${rf.betterAlternatives.length ? ` A route about ${rf.durationMin - rf.betterAlternatives[0].durationMin} min quicker is available.` : ''} Updated ${new Date(rf.refreshedAt).toLocaleTimeString()}.`} />
        )}
        {trip.days.map(d => (
          <View key={d.n} style={{ marginBottom: 20 }}>
            <H>Day {d.n}: {d.from} to {d.to}</H>
            <Muted>{d.departs} to {d.arrives} · {d.distanceKm} km · {hm(d.driveMin)} driving</Muted>
            {d.driveMin > 600 && <Text style={{ color: c.warn, fontSize: 13, marginTop: 4 }}>Long driving day. Plan extra breaks.</Text>}
            <View style={{ height: 8 }} />
            {d.stops.map(st => (
              <Card key={st.id} onPress={() => navigation.navigate('StopDetails', { id: st.id })}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: c[st.kind], marginRight: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600', fontSize: 16, textDecorationLine: st.status === 'skipped' ? 'line-through' : 'none' }}>{st.name}</Text>
                    <Muted>{label[st.kind]} · arrive {st.eta}{st.stayMin ? ` · ${st.stayMin} min` : ''}</Muted>
                    <Muted>{st.detourMin != null ? `Detour about ${st.detourMin} min` : 'Detour not calculated'}</Muted>
                  </View>
                  {st.status !== 'planned' && <Text style={{ color: c.board, fontSize: 12 }}>{st.status === 'visited' ? 'Visited' : 'Skipped'}</Text>}
                </View>
              </Card>))}
            {d.tollInr != null && <Muted>Estimated tolls {inr(d.tollInr)}</Muted>}
          </View>))}
        <Button label={saving ? 'Saving…' : trip.savedId ? 'Save changes' : 'Save trip'} onPress={save} />
        <View style={{ height: 8 }} />
        <Button kind="ghost" label={busy ? 'Checking…' : trip.trafficAware ? 'Refresh traffic and ETA' : 'Re-check route and ETA (no live traffic)'} onPress={refresh} />
        <View style={{ height: 8 }} />
        <Button label="Open trip map" onPress={() => navigation.navigate('TripMap')} />
        <View style={{ height: 8 }} />
        <Button kind="ghost" label="Budget" onPress={() => navigation.navigate('Budget')} />
        <View style={{ height: 32 }} />
      </ScrollView>
    </Screen>
  );
}
