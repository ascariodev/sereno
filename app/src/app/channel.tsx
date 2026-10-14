import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { MessageBody } from '@/components/MessageBody';
import { type Message, useMessagesStore } from '@/messages/store';
import { useAuthStore } from '@/session/auth';

function noticeText(message: Message): string {
  const title = message.payload?.title;
  return typeof title === 'string' && title.trim() !== '' ? title : (message.body ?? '');
}

function MessageRow({ message }: { message: Message }) {
  const { t } = useTranslation();
  const deleted = message.deleted_at !== null;
  const system = message.kind === 'system';
  const ownUserId = useAuthStore((state) => state.user?.id);

  return (
    <View style={styles.message}>
      <View style={styles.head}>
        <Text style={styles.author}>
          {system ? t('channel.notice') : (message.user?.name ?? t('channel.unknownUser'))}
        </Text>
        <Text style={styles.time}>{new Date(message.created_at).toLocaleString()}</Text>
      </View>
      {deleted ? (
        <Text style={styles.deleted}>{t('channel.deleted')}</Text>
      ) : (
        system ? (
          <Text style={styles.body}>{noticeText(message)}</Text>
        ) : (
          <MessageBody body={message.body} mentions={message.mentions} ownUserId={ownUserId} style={styles.body} />
        )
      )}
    </View>
  );
}

export default function Channel() {
  const { t } = useTranslation();
  const { id, name } = useLocalSearchParams<{ id?: string; name?: string }>();
  const channelId = id !== undefined && /^\d+$/.test(id) ? Number(id) : null;
  const { messages, nextCursor, loading, loadingMore, failed, open, loadOlder } = useMessagesStore();

  useEffect(() => {
    if (channelId !== null) void open(channelId);
    return () => useMessagesStore.getState().clear();
  }, [channelId, open]);

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
          renderItem={({ item }) => <MessageRow message={item} />}
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
  message: { gap: 4 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  author: { fontSize: 14, fontWeight: '600' },
  time: { fontSize: 12, color: '#777' },
  body: { fontSize: 15 },
  deleted: { fontSize: 14, fontStyle: 'italic', color: '#777' },
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
