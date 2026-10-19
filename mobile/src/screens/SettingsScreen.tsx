import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Screen, H, Card, Banner, Muted, Button } from '../ui';
import { API_URL, health } from '../api';

type Status = 'checking' | 'osm' | 'mock' | 'google' | 'down';
const LABEL: Record<Status, string> = {
  checking: 'Checking…', osm: 'OpenStreetMap / OSRM mode', mock: 'Mock / demo mode', google: 'Google data (server-side option)', down: 'Server unavailable',
};

export default function SettingsScreen() {
  const [st, setSt] = useState<Status>('checking');
  const [liveTraffic, setLiveTraffic] = useState(false);
  const check = () => {
    setSt('checking');
    health().then(h => { setLiveTraffic(h.liveTraffic === true); setSt(h.provider); }).catch(() => setSt('down'));
  };
  useEffect(check, []);
  return (
    <Screen>
      <H>API status</H>
      {st === 'down' && <Banner tone="warn" text="Server unavailable. Cannot reach the planning server, so no trips can be generated until it is running." />}
      {st === 'mock' && <Banner tone="warn" text="Mock/demo mode. Itineraries are sample data, not real routes or places." />}
      {st === 'osm' && <Banner tone="info" text="Routes use OpenStreetMap data. Live traffic, verified toll prices, ratings and opening hours may not be available." />}
      {st === 'google' && <Banner tone="info" text="The server is using Google data. Traffic and toll estimates are only as good as that data." />}
      <Card><Text style={{ fontWeight: '600' }}>Planning server</Text><Muted>{API_URL}</Muted>
        <Muted>{LABEL[st]}</Muted>
        {st === 'osm' && <Muted>Live traffic: not available</Muted>}
        {st === 'google' && <Muted>Live traffic: {liveTraffic ? 'available' : 'not available'}</Muted>}</Card>
      {st === 'osm' && (
        <Card><Text style={{ fontWeight: '600' }}>Data sources</Text>
          <Muted>Map data © OpenStreetMap contributors. Places: Overpass API. Routing: OSRM. Place search: Nominatim.</Muted>
          <Muted>These are free public services. They can be slow, limit requests, or be unavailable at times.</Muted></Card>)}
      <Button kind="ghost" label="Check again" onPress={check} />
    </Screen>
  );
}
