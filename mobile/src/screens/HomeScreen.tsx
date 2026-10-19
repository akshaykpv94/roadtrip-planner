import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Screen, H, Muted, Card, Button, Banner } from '../ui';
import { useTrip } from '../TripContext';
import { listSaved, loadSaved, deleteSaved, ApiError } from '../api';
import { cacheList, readList, cacheTrip, readTrip, dropTrip, SavedSummary } from '../offline';
import { c } from '../theme';

export default function HomeScreen({ navigation }: any) {
  const { setTrip } = useTrip();
  const [saved, setSaved] = useState<SavedSummary[]>([]);
  const [msg, setMsg] = useState<{ tone: 'warn' | 'info'; text: string } | null>(null);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try { const l = await listSaved(); setSaved(l); setMsg(null); cacheList(l); }
    catch (e) {
      const a = e as ApiError;
      setSaved(await readList());
      setMsg({ tone: 'warn', text: a.kind === 'offline' ? 'Offline. Showing the last list saved on this phone.' : a.message });
    }
  }, []);
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

  const open = async (id: string) => {
    setBusyId(id);
    try { const t = { ...(await loadSaved(id)), savedId: id }; await cacheTrip(t); setTrip(t); navigation.navigate('Itinerary'); }
    catch (e) {
      const copy = await readTrip(id);
      if (copy) { setTrip({ ...copy, offlineCopy: true }); navigation.navigate('Itinerary'); }
      else setMsg({ tone: 'warn', text: `${(e as ApiError).message} No copy of this trip is saved on this phone.` });
    } finally { setBusyId(''); }
  };
  const remove = (s: SavedSummary) => Alert.alert('Delete trip?', `"${s.title}" will be removed from your saved trips.`, [
    { text: 'Keep', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await deleteSaved(s.id); await dropTrip(s.id); load(); } catch (e) { setMsg({ tone: 'warn', text: (e as ApiError).message }); } } },
  ]);

  return (
    <Screen>
      <ScrollView>
        <H>Saved trips</H>
        {msg && <Banner tone={msg.tone} text={msg.text} />}
        {saved.length === 0 && !msg && <Banner tone="info" text="No saved trips yet. Plan a trip, then tap Save trip on its itinerary." />}
        {saved.map(s => (
          <Card key={s.id} onPress={() => open(s.id)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: '600' }}>{s.title}</Text>
                <Muted>Saved {new Date(s.updated_at).toLocaleDateString('en-IN')}{busyId === s.id ? ' · opening…' : ''}</Muted>
                {s.source === 'mock' && <Text style={{ color: c.warn, fontSize: 12 }}>Sample data, not live</Text>}
              </View>
              <Text onPress={() => remove(s)} accessibilityRole="button" style={{ color: c.warn, padding: 8 }}>Delete</Text>
            </View>
          </Card>))}
        <View style={{ height: 12 }} />
        <Button label="Plan a new trip" onPress={() => navigation.navigate('CreateTrip')} />
        <View style={{ height: 8 }} />
        <Button kind="ghost" label="Settings and API status" onPress={() => navigation.navigate('Settings')} />
      </ScrollView>
    </Screen>
  );
}
