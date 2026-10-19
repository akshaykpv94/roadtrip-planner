import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useTrip } from '../TripContext';
import { c, r, s as sp } from '../theme';
import { Banner, Button, Muted } from '../ui';
import { MAP_BASE_URL, OSM_COPYRIGHT_URL, buildMapHtml, type MapStop } from '../mapHtml';
import type { StopKind, Trip } from '../types';

// OpenStreetMap map inside a WebView (Leaflet + OSM raster tiles). No Google Maps SDK, JavaScript API or key is involved.
// Leaflet and the tiles come over the internet, so this screen needs a connection; offline map tiles are not supported.

const KIND_LABEL: Record<StopKind, string> = { food: 'Food', fuel: 'Petrol / charging', hotel: 'Hotel', sight: 'Sightseeing', rest: 'Tea break' };
const LOAD_TIMEOUT_MS = 20_000;
type Phase = 'loading' | 'ready' | 'error';

function TripMap({ trip, navigation }: { trip: Trip; navigation: any }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [tilesFailing, setTilesFailing] = useState(false);
  const [selected, setSelected] = useState<MapStop | null>(null);
  const [attempt, setAttempt] = useState(0);

  const stops: MapStop[] = useMemo(() => trip.days.flatMap(d => d.stops).filter(x => !x.unavailable)
    .map((x, i) => ({ id: x.id, kind: x.kind, n: i + 1, name: x.name, lat: x.lat, lng: x.lng })), [trip]);
  const html = useMemo(() => buildMapHtml({ route: trip.polyline, stops, colors: { food: c.food, fuel: c.fuel, hotel: c.hotel, sight: c.sight, rest: c.rest }, routeColor: c.board }), [trip.polyline, stops]);

  // If the page never reports back (no internet, blocked CDN), say so instead of showing a blank map forever.
  useEffect(() => {
    if (phase !== 'loading') return;
    const t = setTimeout(() => { setError('The map is taking too long to load. Check your internet connection.'); setPhase('error'); }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [phase, attempt]);

  const retry = () => { setPhase('loading'); setError(''); setTilesFailing(false); setSelected(null); setAttempt(a => a + 1); };

  const onMessage = (e: WebViewMessageEvent) => {
    let m: any;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }   // messages come from the page; treat them as untrusted input
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'ready') setPhase(p => (p === 'loading' ? 'ready' : p));
    else if (m.type === 'error') { setError(typeof m.message === 'string' ? m.message.slice(0, 200) : 'The map could not be shown.'); setPhase('error'); }
    else if (m.type === 'tiles-error') setTilesFailing(true);
    else if (m.type === 'tiles-ok') setTilesFailing(false);
    else if (m.type === 'select' && typeof m.id === 'string') setSelected(stops.find(x => x.id === m.id) ?? null);
  };

  // Only the map page itself may load. The attribution link opens in the phone's browser; everything else is blocked.
  const allow = (req: { url: string }) => {
    if (req.url === MAP_BASE_URL || req.url.startsWith('about:') || req.url.startsWith('data:')) return true;
    if (req.url.startsWith(OSM_COPYRIGHT_URL)) Linking.openURL(OSM_COPYRIGHT_URL).catch(() => {});
    return false;
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <View style={{ flex: 1 }}>
        {phase !== 'error' && (
          <WebView key={attempt} style={{ flex: 1 }} source={{ html, baseUrl: MAP_BASE_URL }} originWhitelist={['https://*', 'about:*', 'data:*']}
            javaScriptEnabled domStorageEnabled={false} allowFileAccess={false} setSupportMultipleWindows={false} mixedContentMode="never"
            thirdPartyCookiesEnabled={false} applicationNameForUserAgent="HighwayPlanner/0.1" overScrollMode="never"
            onMessage={onMessage} onShouldStartLoadWithRequest={allow}
            onError={() => { setError('The map could not be loaded. Check your internet connection.'); setPhase('error'); }}
            onHttpError={() => { /* tile or library HTTP errors are reported by the page itself */ }} />
        )}
        {phase === 'loading' && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: c.paper }}>
            <ActivityIndicator size="large" color={c.board} /><Muted>Loading map…</Muted>
          </View>)}
        {phase === 'error' && (
          <View style={{ flex: 1, padding: sp.lg, justifyContent: 'center' }}>
            <Banner tone="warn" text={`${error || 'The map could not be shown.'} The map needs an internet connection; your itinerary is still available.`} />
            <Button label="Try again" onPress={retry} />
          </View>)}
        {phase === 'ready' && tilesFailing && (
          <View style={{ position: 'absolute', top: sp.sm, left: sp.sm, right: sp.sm }}>
            <Banner tone="warn" text="Map tiles could not be loaded. Check your internet connection. The route and stops are still shown." />
          </View>)}
        {phase === 'ready' && selected && (
          <View style={{ position: 'absolute', left: sp.sm, right: sp.sm, bottom: sp.sm, backgroundColor: '#fff', borderRadius: r.md, borderWidth: 1, borderColor: c.line, padding: sp.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: c[selected.kind], marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', fontSize: 16 }} numberOfLines={2}>{selected.n}. {selected.name}</Text>
                <Muted>{KIND_LABEL[selected.kind]}</Muted>
              </View>
              <Pressable onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel="Close" style={{ padding: sp.sm }}><Text style={{ color: c.muted, fontSize: 18 }}>✕</Text></Pressable>
            </View>
            <View style={{ height: sp.sm }} />
            <Button label="Stop details" onPress={() => navigation.navigate('StopDetails', { id: selected.id })} />
          </View>)}
      </View>
      <Pressable onPress={() => Linking.openURL(OSM_COPYRIGHT_URL).catch(() => {})} accessibilityRole="link"
        style={{ paddingVertical: 6, paddingHorizontal: sp.md, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: c.line }}>
        <Text style={{ fontSize: 12, color: c.muted }}>© OpenStreetMap contributors · Routing by OSRM · Places from Overpass. Needs internet; no offline maps.</Text>
      </Pressable>
    </View>
  );
}

export default function TripMapScreen({ navigation }: any) {
  const { trip } = useTrip();
  if (!trip) return null;
  return <TripMap trip={trip} navigation={navigation} />;
}
