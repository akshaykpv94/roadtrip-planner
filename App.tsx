import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TripProvider } from './src/TripContext';
import { c } from './src/theme';
import Home from './src/screens/HomeScreen';
import CreateTrip from './src/screens/CreateTripScreen';
import Itinerary from './src/screens/ItineraryScreen';
import TripMap from './src/screens/TripMapScreen';
import StopDetails from './src/screens/StopDetailsScreen';
import Budget from './src/screens/BudgetScreen';
import Settings from './src/screens/SettingsScreen';

const Stack = createNativeStackNavigator();
export default function App() {
  return (
    <TripProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: c.board }, headerTintColor: '#fff' }}>
          <Stack.Screen name="Home" component={Home} options={{ title: 'Highway Planner' }} />
          <Stack.Screen name="CreateTrip" component={CreateTrip} options={{ title: 'New trip' }} />
          <Stack.Screen name="Itinerary" component={Itinerary} />
          <Stack.Screen name="TripMap" component={TripMap} options={{ title: 'Trip map' }} />
          <Stack.Screen name="StopDetails" component={StopDetails} options={{ title: 'Stop' }} />
          <Stack.Screen name="Budget" component={Budget} />
          <Stack.Screen name="Settings" component={Settings} />
        </Stack.Navigator>
      </NavigationContainer>
    </TripProvider>
  );
}
