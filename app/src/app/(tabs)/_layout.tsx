import Tabs from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useNotificationsStore } from '@/notifications/store';
import { useOrganizationStore } from '@/organization/store';

export default function TabsLayout() {
  const { t } = useTranslation();
  const unreadCount = useNotificationsStore((state) => state.unreadCount);
  const activeId = useOrganizationStore((state) => state.activeId);

  useEffect(() => {
    const state = useNotificationsStore.getState();
    if (activeId !== null && !state.loaded && !state.loading) void state.refresh();
  }, [activeId]);

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: t('projects.title') }} />
      <Tabs.Screen
        name="notifications"
        options={{
          title: t('notifications.title'),
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarAccessibilityLabel:
            unreadCount > 0 ? `${t('notifications.title')}, ${t('notifications.unreadBadge', { count: unreadCount })}` : undefined,
        }}
      />
      <Tabs.Screen name="settings" options={{ title: t('settings.title') }} />
    </Tabs>
  );
}
