import { Tabs } from 'expo-router';
import { Platform, Text } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';

export default function TabLayout() {
  const { user } = useAuth();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#C85A2E',
        tabBarInactiveTintColor: '#8B6245',
        tabBarStyle: {
          backgroundColor: '#F5EDD6',
          borderTopColor: '#EDD9A3',
          borderTopWidth: 1.5,
          paddingBottom: 4,
        },
        tabBarLabelStyle: {
          fontFamily: Platform.select({ web: 'Raleway, system-ui, sans-serif', default: undefined }),
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 16, color }}>🏡</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: 'Family',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 16, color }}>🚪</Text>
          ),
          // Hidden for non-admins
          tabBarButton: user?.isAdmin ? undefined : () => null,
        }}
      />
    </Tabs>
  );
}
