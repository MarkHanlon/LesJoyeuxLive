import { Stack } from 'expo-router';
import InstallPrompt from '../components/InstallPrompt';

export default function RootLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <InstallPrompt />
    </>
  );
}
