import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { installI18nOnApi } from '@/i18n';
import { installAuthOnApi, useAuthStore } from '@/session/auth';

installI18nOnApi();
installAuthOnApi();

export default function RootLayout() {
  const hydrate = useAuthStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
