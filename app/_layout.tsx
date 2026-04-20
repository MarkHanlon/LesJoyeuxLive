import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import InstallPrompt from '../components/InstallPrompt';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

function RootLayoutContent() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (Platform.OS === 'web' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const segment = segments[0] as string | undefined;

    if (!user) {
      if (segment !== 'enter-name') router.replace('/enter-name');
    } else if (user.status === 'pending') {
      if (segment !== 'pending') router.replace('/pending');
    } else if (user.status === 'approved') {
      if (segment !== '(tabs)') router.replace('/(tabs)');
    }
  }, [user, isLoading, segments]);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <Text style={styles.loadingSymbol}>⚜</Text>
        </View>
      )}
      <InstallPrompt />
    </>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F5EDD6',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  loadingSymbol: {
    fontSize: 52,
    color: '#C8973D',
  },
});

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutContent />
    </AuthProvider>
  );
}
