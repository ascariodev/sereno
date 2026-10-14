import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { installI18nOnApi } from '@/i18n';
import { installOrganizationOnApi, useOrganizationStore } from '@/organization/store';
import { installAuthOnApi, useAuthStore } from '@/session/auth';

installI18nOnApi();
installAuthOnApi();
installOrganizationOnApi();

export default function RootLayout() {
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrated = useAuthStore((state) => state.hydrated);
  const signedIn = useAuthStore((state) => state.token !== null);

  const hasOrganization = useOrganizationStore((state) => state.activeId !== null);
  const organizationsSettled = useOrganizationStore((state) => state.loaded || state.loadError);
  const loadOrganizations = useOrganizationStore((state) => state.load);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (signedIn) void loadOrganizations();
  }, [signedIn, loadOrganizations]);

  if (!hydrated || (signedIn && !organizationsSettled)) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn && hasOrganization}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="select-organization" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
      </Stack.Protected>
    </Stack>
  );
}
