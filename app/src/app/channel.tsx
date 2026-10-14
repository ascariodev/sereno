import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { MessageComposer } from '@/components/MessageComposer';
import { MessageRow } from '@/components/MessageRow';
import { useMessagesStore } from '@/messages/store';
import { useThreadStore } from '@/messages/threadStore';
import { useOrganizationStore } from '@/organization/store';
import { isLogGroupOpenedPayload, isLogGroupStatusChangedPayload } from '@/messages/payload';
import { useProjectsStore } from '@/projects/store';
import { onReconnect, subscribeToChannel } from '@/realtime/echo';

export default function Channel() {
  const { t } = useTranslation();
  const { id, name } = useLocalSearchParams<{ id?: string; name?: string }>();
  const channelId = id !== undefined && /^\d+$/.test(id) ? Number(id) : null;
  const { messages, nextCursor, loading, loadingMore, failed, open, loadOlder } = useMessagesStore();

  useEffect(() => {
    if (channelId !== null) void open(channelId);
    return () => {
      useMessagesStore.getState().clear();
      useThreadStore.getState().clear();
    };
  }, [channelId, open]);

  const organizationId = useOrganizationStore((state) => state.activeId);

  useEffect(() => {
    if (channelId === null || organizationId === null) return;
    const unsubscribe = subscribeToChannel(organizationId, channelId, {
      onCreated: (message) => {
        const store = useMessagesStore.getState();
        store.insert(message);
        useThreadStore.getState().insert(message);
        if (isLogGroupOpenedPayload(message.payload) || isLogGroupStatusChangedPayload(message.payload)) {
          useProjectsStore.getState().refreshCounts();
        }
      },
      onUpdated: (message) => {
        useMessagesStore.getState().replace(message);
        useThreadStore.getState().replace(message);
      },
      onDeleted: (event) => {
        useMessagesStore.getState().remove(event);
        useThreadStore.getState().remove(event);
      },
    });
    const unsubscribeReconnect = onReconnect(() => {
      void useMessagesStore.getState().catchUp();
      void useThreadStore.getState().catchUp();
      useProjectsStore.getState().refreshCounts();
    });
    return () => {
      unsubscribe();
      unsubscribeReconnect();
    };
  }, [channelId, organizationId]);

  const openThread = useCallback(
    (messageId: number) => {
      if (channelId !== null) router.push({ pathname: '/thread', params: { channelId: String(channelId), id: String(messageId) } });
    },
    [channelId],
  );

  const visible = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {name ?? t('channel.title')}
      </Text>
      {channelId === null ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('channel.invalid')}
        </Text>
      ) : loading ? (
        <View style={styles.block}>
          <ActivityIndicator />
          <Text accessibilityRole="progressbar">{t('common.loading')}</Text>
        </View>
      ) : failed && messages.length === 0 ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('channel.loadFailed')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void open(channelId)} style={styles.button}>
            <Text style={styles.buttonText}>{t('projects.retry')}</Text>
          </Pressable>
        </View>
      ) : visible.length === 0 && nextCursor === null ? (
        <Text style={styles.empty}>{t('channel.empty')}</Text>
      ) : (
        <FlatList
          testID="messages-list"
          inverted
          data={visible}
          keyExtractor={(message) => String(message.id)}
          renderItem={({ item }) => <MessageRow message={item} onOpenThread={openThread} />}
          onEndReached={() => void loadOlder()}
          onEndReachedThreshold={0.5}
          contentContainerStyle={styles.list}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator accessibilityLabel={t('channel.loadingMore')} />
            ) : failed ? (
              <Pressable accessibilityRole="button" onPress={() => void loadOlder()} style={styles.button}>
                <Text style={styles.buttonText}>{t('channel.loadOlderFailed')}</Text>
              </Pressable>
            ) : null
          }
        />
      )}
      {channelId !== null && !loading && !(failed && messages.length === 0) ? <MessageComposer /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  list: { gap: 12 },
  block: { gap: 10 },
  empty: { fontSize: 14, color: '#555' },
  error: { color: '#c0392b', fontSize: 14 },
  button: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#888',
  },
  buttonText: { fontSize: 16 },
});
