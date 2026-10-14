import { router } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { relativeTime } from '@/components/ThreadSummary';
import { useNotificationsStore } from '@/notifications/store';
import { isTaskNotification, notificationTarget } from '@/notifications/target';
import { notificationBody, notificationTitle } from '@/notifications/text';
import type { AppNotification } from '@/notifications/types';
import { useOrganizationStore } from '@/organization/store';

function NotificationRow({ notification }: { notification: AppNotification }) {
  const { t, i18n } = useTranslation();
  const body = notificationBody(notification);
  const unread = notification.read_at === null;
  const target = notificationTarget(notification);
  const unavailable = target === null && isTaskNotification(notification);

  function open() {
    void useNotificationsStore.getState().markRead(notification);
    if (target !== null) router.push(target);
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: unread }}
      onPress={open}
      style={[styles.row, unread && styles.unread]}
    >
      <View style={styles.main}>
        <Text style={styles.rowTitle}>
          {unread ? `${t('notifications.unread')}: ` : ''}
          {notificationTitle(notification, t)}
        </Text>
        {body !== null ? (
          <Text numberOfLines={3} style={styles.body}>
            {body}
          </Text>
        ) : null}
        {unavailable ? <Text style={styles.note}>{t('notifications.notAvailable')}</Text> : null}
        <Text style={styles.when}>{relativeTime(notification.created_at, i18n.language)}</Text>
      </View>
    </Pressable>
  );
}

export default function Notifications() {
  const { t } = useTranslation();
  const activeId = useOrganizationStore((state) => state.activeId);
  const { notifications, unreadCount, nextCursor, loaded, loading, loadingMore, error, loadMoreFailed } =
    useNotificationsStore();

  useEffect(() => {
    const state = useNotificationsStore.getState();
    if (activeId !== null && !state.loading && (!state.loaded || state.error !== null)) void state.refresh();
  }, [activeId]);

  const retry = () => void useNotificationsStore.getState().refresh();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('notifications.title')}
        </Text>
        {loaded && unreadCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void useNotificationsStore.getState().markAllRead()}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{t('notifications.markAllRead')}</Text>
          </Pressable>
        ) : null}
      </View>
      {!loaded && error === null ? (
        <View style={styles.block}>
          <ActivityIndicator />
          <Text accessibilityRole="progressbar">{t('common.loading')}</Text>
        </View>
      ) : !loaded ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('notifications.loadFailed')}
          </Text>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.button}>
            <Text style={styles.buttonText}>{t('projects.retry')}</Text>
          </Pressable>
        </View>
      ) : notifications.length === 0 ? (
        <Text style={styles.emptyTitle}>{t('notifications.empty')}</Text>
      ) : (
        <FlatList
          testID="notifications-list"
          data={notifications}
          keyExtractor={(notification) => String(notification.id)}
          renderItem={({ item }) => <NotificationRow notification={item} />}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={retry}
          onEndReached={() => void useNotificationsStore.getState().loadMore()}
          ListHeaderComponent={
            error !== null ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {t('notifications.loadFailed')}
              </Text>
            ) : null
          }
          ListFooterComponent={
            nextCursor !== null ? (
              <View style={styles.block}>
                {loadMoreFailed ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {t('notifications.loadMoreFailed')}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={loadingMore}
                  onPress={() => void useNotificationsStore.getState().loadMore()}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>
                    {loadingMore ? t('common.loading') : loadMoreFailed ? t('projects.retry') : t('notifications.loadMore')}
                  </Text>
                </Pressable>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  list: { gap: 8, paddingBottom: 24 },
  block: { gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  error: { color: '#c0392b', fontSize: 14 },
  row: { padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#ccc' },
  unread: { backgroundColor: '#eef4ff', borderColor: '#2563eb' },
  main: { gap: 4 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 14, color: '#444' },
  note: { fontSize: 12, color: '#777', fontStyle: 'italic' },
  when: { fontSize: 12, color: '#777' },
  button: {
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#888',
  },
  buttonText: { fontSize: 15 },
});
