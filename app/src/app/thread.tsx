import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { MessageComposer } from '@/components/MessageComposer';
import { MessageRow } from '@/components/MessageRow';
import { useMessagesStore } from '@/messages/store';
import { useThreadStore } from '@/messages/threadStore';

function parseId(value: string | undefined): number | null {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

export default function Thread() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ channelId?: string; id?: string }>();
  const channelId = parseId(params.channelId);
  const rootId = parseId(params.id);
  const { root: threadRoot, replies, nextCursor, loading, loadingMore, failed, notFound, open, loadOlder } = useThreadStore();
  const listRoot = useMessagesStore((state) => state.messages.find((message) => message.id === rootId && message.channel_id === channelId));
  const root = threadRoot?.id === rootId ? threadRoot : (listRoot ?? null);

  useEffect(() => {
    if (channelId !== null && rootId !== null) void open(channelId, rootId);
    return () => useThreadStore.getState().clear();
  }, [channelId, rootId, open]);

  const visible = useMemo(() => [...replies].reverse(), [replies]);
  const rootDeletedWithoutReplies = root !== null && root.deleted_at !== null && root.replies_count === 0 && replies.length === 0;
  const count = root?.replies_count ?? replies.length;

  if (channelId === null || rootId === null || notFound) {
    return (
      <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('thread.title')}
        </Text>
        <Text accessibilityRole="alert" style={styles.error}>
          {t('thread.notFound')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('thread.title')}
      </Text>
      {root !== null ? (
        <View testID="thread-root">
          <MessageRow message={root} />
        </View>
      ) : !loading ? (
        <Text style={styles.empty}>{t('thread.rootUnavailable')}</Text>
      ) : null}
      <Text style={styles.count}>{t('thread.replies', { count })}</Text>
      {loading ? (
        <View style={styles.block}>
          <ActivityIndicator />
          <Text accessibilityRole="progressbar">{t('common.loading')}</Text>
        </View>
      ) : failed && replies.length === 0 ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('thread.loadFailed')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void open(channelId, rootId)} style={styles.button}>
            <Text style={styles.buttonText}>{t('projects.retry')}</Text>
          </Pressable>
        </View>
      ) : visible.length === 0 && nextCursor === null ? (
        <Text style={styles.empty}>{t('thread.noReplies')}</Text>
      ) : (
        <FlatList
          testID="replies-list"
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
                <Text style={styles.buttonText}>{t('thread.loadOlderFailed')}</Text>
              </Pressable>
            ) : null
          }
        />
      )}
      {!loading && !(failed && replies.length === 0) && !rootDeletedWithoutReplies ? (
        <MessageComposer channelId={channelId} send={useThreadStore.getState().send} placeholder={t('thread.replyPlaceholder')} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  count: { fontSize: 13, fontWeight: '500', color: '#444' },
  list: { gap: 12 },
  block: { gap: 10 },
  empty: { fontSize: 14, color: '#555' },
  error: { color: '#c0392b', fontSize: 14 },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#888' },
  buttonText: { fontSize: 16 },
});
