import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Screen, H, Card, Banner, Muted, Button } from '../ui';
import { API_URL, health } from '../api';

export default function SettingsScreen() {
  const [st, setSt] = useState<'checking' | 'live' | 'mock' | 'down'>('checking');
  const check = () => { setSt('checking'); health().then(h => setSt(h.live ? 'live' : 'mock')).catch(() => setSt('down')); };
  useEffect(check, []);
  return (
    <Screen>
      <H>API status</H>
      {st === 'down' && <Banner tone="warn" text="Cannot reach the planning server. No trips can be generated until it is running." />}
      {st === 'mock' && <Banner tone="warn" text="Server is in mock mode. Itineraries are test data, not real routes or places." />}
      {st === 'live' && <Banner tone="info" text="Connected to Google Maps data." />}
      <Card><Text style={{ fontWeight: '600' }}>Planning server</Text><Muted>{API_URL}</Muted>
        <Muted>{{ checking: 'Checking…', live: 'Live', mock: 'Mock mode', down: 'Unreachable' }[st]}</Muted></Card>
      <Button kind="ghost" label="Check again" onPress={check} />
    </Screen>
  );
}
