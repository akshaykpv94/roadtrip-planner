import React from 'react';
import { Linking, Text, View } from 'react-native';
import { Screen, H, Muted, Button } from '../ui';
import { useTrip } from '../TripContext';

export default function StopDetailsScreen({ route, navigation }: any) {
  const { trip, mark } = useTrip();
  const stop = trip?.days.flatMap(d => d.stops).find(x => x.id === route.params.id);
  if (!stop) return <Screen><Text>This stop is no longer in the itinerary.</Text></Screen>;
  const open = () => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`);
  const alts = stop.alternatives ?? [];
  // Missing fields are shown as unavailable, never invented.
  return (
    <Screen>
      <H>{stop.name}</H>
      <Muted>{stop.address ?? 'Address unavailable'}</Muted>
      <View style={{ height: 12 }} />
      <Text>Rating: {stop.rating != null ? `${stop.rating} (${stop.reviews ?? 0} reviews)` : 'Not available'}</Text>
      <Text>Hours: {stop.hours ?? 'Not available'}</Text>
      <Text>Phone: {stop.phone ?? 'Not available'}</Text>
      <Text>Detour: {stop.detourKm != null ? `${stop.detourKm} km, about ${stop.detourMin} min` : 'Not calculated'}</Text>
      {alts.length > 0 && <Text style={{ marginTop: 12 }}>Alternatives: {alts.map(a => a.name).join(', ')}</Text>}
      <View style={{ height: 16 }} />
      <Button label="Navigate in Google Maps" onPress={open} />
      <View style={{ height: 8 }} />
      <Button kind="ghost" label="Mark visited" onPress={() => { mark(stop.id, 'visited'); navigation.goBack(); }} />
      <View style={{ height: 8 }} />
      <Button kind="ghost" label="Skip this stop" onPress={() => { mark(stop.id, 'skipped'); navigation.goBack(); }} />
    </Screen>
  );
}
