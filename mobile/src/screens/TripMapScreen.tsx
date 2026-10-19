import React from 'react';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useTrip } from '../TripContext';
import { c } from '../theme';

export default function TripMapScreen({ navigation }: any) {
  const { trip } = useTrip();
  if (!trip) return null;
  const stops = trip.days.flatMap(d => d.stops).filter(x => !x.unavailable);
  const first = trip.polyline[0] ?? stops[0] ?? { lat: 20.6, lng: 78.9 };
  return (
    <MapView style={{ flex: 1 }} showsTraffic initialRegion={{ latitude: first.lat, longitude: first.lng, latitudeDelta: 8, longitudeDelta: 8 }}>
      <Polyline coordinates={trip.polyline.map(p => ({ latitude: p.lat, longitude: p.lng }))} strokeColor={c.board} strokeWidth={5} />
      {stops.map((s, i) => (
        <Marker key={s.id} coordinate={{ latitude: s.lat, longitude: s.lng }} pinColor={c[s.kind]}
          title={`${i + 1}. ${s.name}`} description={s.kind} onCalloutPress={() => navigation.navigate('StopDetails', { id: s.id })} />))}
    </MapView>
  );
}
