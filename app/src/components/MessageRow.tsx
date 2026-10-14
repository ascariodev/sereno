import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { MessageAttachments } from '@/components/MessageAttachments';
import { MessageBody } from '@/components/MessageBody';
import { MessageEditor } from '@/components/MessageEditor';
import { SystemNotice } from '@/components/SystemNotice';
import { ThreadSummary } from '@/components/ThreadSummary';
import { type Message, type MessageDeletedEvent, type RootCounters, useMessagesStore } from '@/messages/store';
import { useThreadStore } from '@/messages/threadStore';
import { useOrganizationStore } from '@/organization/store';
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
    const response = await api.delete<{ data: Message; meta?: { root?: RootCounters } }>(`/api/channels/${message.channel_id}/messages/${message.id}`);
    const event: MessageDeletedEvent = {
      id: message.id,
      channel_id: message.channel_id,
      parent_id: message.parent_id,
      deleted_at: response.data.deleted_at ?? new Date().toISOString(),
      root: response.meta?.root ?? { id: message.parent_id ?? message.id, replies_count: response.data.replies_count, last_reply_at: response.data.last_reply_at },
    };
    useMessagesStore.getState().remove(event);
    useThreadStore.getState().remove(event);
  } catch (caught) {
    const status = caught instanceof ApiError ? caught.status : 0;
    Alert.alert(t(deleteErrorKey(status)));
    if (status === 404) {
      void useMessagesStore.getState().catchUp();
      void useThreadStore.getState().catchUp();
    }
  }
}

export function MessageRow({ message, onOpenThread }: { message: Message; onOpenThread?: (messageId: number) => void }) {
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
      {message.deleted_at === null && !isEditing && (message.attachments?.length ?? 0) > 0 ? <MessageAttachments attachments={message.attachments ?? []} /> : null}
      {onOpenThread !== undefined && message.parent_id === null && (message.deleted_at === null || message.replies_count > 0) ? <ThreadSummary message={message} onOpen={onOpenThread} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  buttonText: { fontSize: 16 },
});
