import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { installI18nOnApi } from '@/i18n';
import { installAuthOnApi, useAuthStore } from '@/session/auth';

installI18nOnApi();
installAuthOnApi();

export default function RootLayout() {
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrated = useAuthStore((state) => state.hydrated);
  const signedIn = useAuthStore((state) => state.token !== null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!hydrated) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
      </Stack.Protected>
    </Stack>
  );
}
