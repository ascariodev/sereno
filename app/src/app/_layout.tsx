import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { ApiError } from '@/api/client';
import { installI18nOnApi } from '@/i18n';
import { installOrganizationOnApi, useOrganizationStore } from '@/organization/store';
import { usePushRegistration } from '@/push/device';
import { usePushOpen } from '@/push/open';
import { useRealtimeSession } from '@/realtime/useRealtimeSession';
import { installAuthOnApi, useAuthStore } from '@/session/auth';

installI18nOnApi();
installAuthOnApi();
installOrganizationOnApi();

export default function RootLayout() {
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrated = useAuthStore((state) => state.hydrated);
  const signedIn = useAuthStore((state) => state.token !== null);
  const userMissing = useAuthStore((state) => state.user === null);
  const fetchMe = useAuthStore((state) => state.fetchMe);

  const hasOrganization = useOrganizationStore((state) => state.activeId !== null);
  const organizationsSettled = useOrganizationStore((state) => state.loaded || state.loadError);
  const loadOrganizations = useOrganizationStore((state) => state.load);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (signedIn) void loadOrganizations();
  }, [signedIn, loadOrganizations]);

  useEffect(() => {
    if (!signedIn || !userMissing) return;
    fetchMe().catch((error: unknown) => {
      if (!(error instanceof ApiError)) throw error;
    });
  }, [signedIn, userMissing, fetchMe]);

  useRealtimeSession();
  usePushRegistration(signedIn);

  const ready = hydrated && (!signedIn || organizationsSettled);
  usePushOpen(ready);

  if (!ready) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn && hasOrganization}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="project-form" />
        <Stack.Screen name="channel" />
        <Stack.Screen name="thread" />
        <Stack.Screen name="tasks" />
        <Stack.Screen name="task" />
        <Stack.Screen name="log" />
        <Stack.Screen name="log-group" />
        <Stack.Screen name="integrations" />
        <Stack.Screen name="project-members" />
        <Stack.Screen name="members" />
        <Stack.Screen name="invitations" />
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
