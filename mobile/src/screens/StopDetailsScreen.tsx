import React from 'react';
import { Linking, Text, View } from 'react-native';
import { Screen, H, Muted, Button } from '../ui';
import { useTrip } from '../TripContext';

export default function StopDetailsScreen({ route, navigation }: any) {
  const { trip, mark } = useTrip();
  const stop = trip?.days.flatMap(d => d.stops).find(x => x.id === route.params.id);
  if (!stop) return <Screen><Text>This stop is no longer in the itinerary.</Text></Screen>;
  // Hands off to whichever maps app the phone has (a geo: link), so no particular map service or key is needed.
  const navigate = async () => {
    const label = encodeURIComponent(stop.name.replace(/[()]/g, ' '));
    try { await Linking.openURL(`geo:${stop.lat},${stop.lng}?q=${stop.lat},${stop.lng}(${label})`); }
    catch { Linking.openURL(`https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=%3B${stop.lat}%2C${stop.lng}`).catch(() => {}); }
  };
  const osmUrl = stop.mapsUri?.startsWith('https://www.openstreetmap.org/') ? stop.mapsUri : undefined;
  const alts = stop.alternatives ?? [];
  // Missing fields are shown as unavailable, never invented.
  return (
    <Screen>
      <H>{stop.name}</H>
      <Muted>{stop.address ?? 'Address unavailable'}</Muted>
      <View style={{ height: 12 }} />
      <Text>Rating: {stop.rating != null ? `${stop.rating} (${stop.reviews ?? 0} reviews)` : 'Not available'}</Text>
      <Text>Hours: {stop.hours ? `${stop.hours} (from OpenStreetMap, may be out of date)` : 'Not available'}</Text>
      <Text>Phone: {stop.phone ?? 'Not available'}</Text>
      <Text>Detour: {stop.detourKm != null ? `about ${stop.detourKm} km, about ${stop.detourMin} min (approximate, straight-line)` : 'Not calculated'}</Text>
      {alts.length > 0 && <Text style={{ marginTop: 12 }}>Alternatives: {alts.map(a => a.name).join(', ')}</Text>}
      <View style={{ height: 16 }} />
      <Button label="Navigate (opens your maps app)" onPress={navigate} />
      {osmUrl && <><View style={{ height: 8 }} /><Button kind="ghost" label="View on OpenStreetMap" onPress={() => Linking.openURL(osmUrl).catch(() => {})} /></>}
      <View style={{ height: 8 }} />
      <Button kind="ghost" label="Mark visited" onPress={() => { mark(stop.id, 'visited'); navigation.goBack(); }} />
      <View style={{ height: 8 }} />
      <Button kind="ghost" label="Skip this stop" onPress={() => { mark(stop.id, 'skipped'); navigation.goBack(); }} />
    </Screen>
  );
}
