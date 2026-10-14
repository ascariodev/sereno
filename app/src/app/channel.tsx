import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { MessageComposer } from '@/components/MessageComposer';
import { MessageEditor } from '@/components/MessageEditor';
import { MessageBody } from '@/components/MessageBody';
import { SystemNotice } from '@/components/SystemNotice';
import { type Message, useMessagesStore } from '@/messages/store';
import { useOrganizationStore } from '@/organization/store';
import { isLogGroupOpenedPayload, isLogGroupStatusChangedPayload } from '@/messages/payload';
import { useProjectsStore } from '@/projects/store';
import { onReconnect, subscribeToChannel } from '@/realtime/echo';
import { useAuthStore } from '@/session/auth';

function canEditMessage(message: Message, ownUserId: number | undefined): boolean {
  return message.kind === 'user' && message.deleted_at === null && ownUserId !== undefined && message.user?.id === ownUserId;
}

function canDeleteMessage(message: Message, ownUserId: number | undefined, canModerate: boolean): boolean {
  return message.kind === 'user' && message.deleted_at === null && ownUserId !== undefined && (message.user?.id === ownUserId || canModerate);
}

function deleteErrorKey(status: number): string {
  if (status === 403) return 'message.deleteForbidden';
  if (status === 404) return 'message.deleteGone';
  if (status === 422) return 'message.deleteArchived';
  if (status === 429) return 'message.deleteThrottled';
  return 'message.deleteFailed';
}

async function deleteMessage(message: Message, t: (key: string) => string): Promise<void> {
  try {
    const response = await api.delete<{ data: Message }>(`/api/channels/${message.channel_id}/messages/${message.id}`);
    useMessagesStore.getState().remove({
      id: message.id,
      channel_id: message.channel_id,
      parent_id: message.parent_id,
      deleted_at: response.data.deleted_at ?? new Date().toISOString(),
    });
  } catch (caught) {
    const status = caught instanceof ApiError ? caught.status : 0;
    Alert.alert(t(deleteErrorKey(status)));
    if (status === 404) void useMessagesStore.getState().catchUp();
  }
}

function MessageRow({ message }: { message: Message }) {
  const { t } = useTranslation();
  const ownUserId = useAuthStore((state) => state.user?.id);
  const canModerate = useOrganizationStore((state) => state.canModerate());
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  if (message.kind === 'system') return <SystemNotice message={message} />;

  const canEdit = canEditMessage(message, ownUserId);
  const canDelete = canDeleteMessage(message, ownUserId, canModerate);
  const isEditing = editing && canEdit;

  function confirmDelete() {
    setMenuOpen(false);
    Alert.alert(t('message.deleteTitle'), t('message.deleteConfirm'), [
      { text: t('message.cancel'), style: 'cancel' },
      { text: t('message.delete'), style: 'destructive', onPress: () => void deleteMessage(message, t) },
    ]);
  }

  return (
    <View style={styles.message}>
      <View style={styles.head}>
        <Text style={styles.author}>{message.user?.name ?? t('channel.unknownUser')}</Text>
        <Text style={styles.time}>{new Date(message.created_at).toLocaleString()}</Text>
        {message.deleted_at === null && message.edited_at !== null ? <Text style={styles.time}>{t('message.edited')}</Text> : null}
        {(canEdit || canDelete) && !isEditing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('message.actions')}
            onPress={() => setMenuOpen((open) => !open)}
            style={styles.menuTrigger}
          >
            <Text style={styles.menuTriggerText}>...</Text>
          </Pressable>
        ) : null}
      </View>
      {menuOpen && !isEditing ? (
        <View style={styles.menu}>
          {canEdit ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                setEditing(true);
              }}
              style={styles.menuItem}
            >
              <Text style={styles.buttonText}>{t('message.edit')}</Text>
            </Pressable>
          ) : null}
          {canDelete ? (
            <Pressable accessibilityRole="button" onPress={confirmDelete} style={styles.menuItem}>
              <Text style={[styles.buttonText, styles.danger]}>{t('message.delete')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {message.deleted_at !== null ? (
        <Text style={styles.deleted}>{t('channel.deleted')}</Text>
      ) : isEditing ? (
        <MessageEditor message={message} onDone={() => setEditing(false)} />
      ) : (
        <MessageBody body={message.body} mentions={message.mentions} ownUserId={ownUserId} style={styles.body} />
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

  const organizationId = useOrganizationStore((state) => state.activeId);

  useEffect(() => {
    if (channelId === null || organizationId === null) return;
    const unsubscribe = subscribeToChannel(organizationId, channelId, {
      onCreated: (message) => {
        const store = useMessagesStore.getState();
        store.insert(message);
        if (isLogGroupOpenedPayload(message.payload) || isLogGroupStatusChangedPayload(message.payload)) {
          useProjectsStore.getState().refreshCounts();
        }
      },
      onUpdated: (message) => useMessagesStore.getState().replace(message),
      onDeleted: (event) => useMessagesStore.getState().remove(event),
    });
    const unsubscribeReconnect = onReconnect(() => {
      void useMessagesStore.getState().catchUp();
      useProjectsStore.getState().refreshCounts();
    });
    return () => {
      unsubscribe();
      unsubscribeReconnect();
    };
  }, [channelId, organizationId]);

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
  message: { gap: 4 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  author: { fontSize: 14, fontWeight: '600' },
  time: { fontSize: 12, color: '#777' },
  body: { fontSize: 15 },
  deleted: { fontSize: 14, fontStyle: 'italic', color: '#777' },
  menuTrigger: { minHeight: 44, minWidth: 44, marginVertical: -12, alignItems: 'center', justifyContent: 'center' },
  menuTriggerText: { fontSize: 18, fontWeight: '700', color: '#555' },
  menu: { flexDirection: 'row', gap: 8 },
  menuItem: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#888' },
  danger: { color: '#c0392b' },
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
