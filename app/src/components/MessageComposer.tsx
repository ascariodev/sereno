import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/client';
import { ATTACHMENT_MAX_PER_MESSAGE, formatFileSize, toPickedFile, type PickedFile } from '@/messages/attachments';
import { useMessagesStore } from '@/messages/store';
import { useAttachmentUploads } from '@/messages/useAttachmentUploads';
import {
  EMPTY_MENTION_STATE,
  findQuery,
  moveCaret,
  selectMember,
  serializeMentions,
  suggestionsFor,
  updateText,
  type MentionState,
} from '@/mentions/mentionInput';
import { useMemberDirectoryStore } from '@/projects/members';
import { useProjectsStore } from '@/projects/store';
import { useAuthStore } from '@/session/auth';

export const MAX_MESSAGE_LENGTH = 4000;

interface MessageComposerProps {
  channelId?: number | null;
  send?: (body: string, attachmentIds: number[]) => Promise<void>;
  placeholder?: string;
}

export function MessageComposer({ channelId: channelIdProp, send, placeholder }: MessageComposerProps = {}) {
  const { t, i18n } = useTranslation();
  const [mention, setMention] = useState<MentionState>(EMPTY_MENTION_STATE);
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | undefined>();
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const storeChannelId = useMessagesStore((state) => state.channelId);
  const channelId = channelIdProp ?? storeChannelId;
  const projectId = useProjectsStore((state) => {
    const entry = Object.entries(state.channelByProject).find(([, id]) => id === channelId);
    return entry ? Number(entry[0]) : null;
  });
  const members = useMemberDirectoryStore((state) => (projectId === null ? undefined : state.entries[projectId]?.members));
  const ownUserId = useAuthStore((state) => state.user?.id);
  const uploads = useAttachmentUploads(channelId);

  const body = serializeMentions(mention);
  const tooLong = [...body].length > MAX_MESSAGE_LENGTH;
  const canSend =
    !sending && !uploads.busy && !tooLong && (body.trim() !== '' || uploads.attachmentIds.length > 0);
  const canAttach = channelId !== null && !picking && !uploads.full;
  const suggestions = suggestionsFor(mention, members ?? [], ownUserId);
  const querying = findQuery(mention) !== null;

  useEffect(() => {
    if (querying) void useMemberDirectoryStore.getState().ensureLoaded(projectId);
  }, [querying, projectId]);

  function choose(member: { id: number; name: string }) {
    const next = selectMember(mention, member);
    setMention(next);
    if (next.caret !== null) setForcedSelection({ start: next.caret, end: next.caret });
  }

  async function pick(source: 'media' | 'file') {
    setMenuOpen(false);
    setPicking(true);
    setErrorText(null);
    try {
      let picked: PickedFile[] = [];
      if (source === 'media') {
        const remaining = ATTACHMENT_MAX_PER_MESSAGE - uploads.items.filter((item) => item.status !== 'error').length;
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          allowsMultipleSelection: true,
          selectionLimit: Math.max(1, remaining),
        });
        if (!result.canceled) picked = result.assets.map(toPickedFile);
      } else {
        const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
        if (!result.canceled) picked = result.assets.map(toPickedFile);
      }
      uploads.add(picked);
    } catch {
      setErrorText(t('attachments.pickFailed'));
    } finally {
      setPicking(false);
    }
  }

  async function submit() {
    if (!canSend) return;
    setSending(true);
    setErrorText(null);
    const sentText = mention.text;
    const sentIds = [...uploads.attachmentIds];
    try {
      await (send ?? useMessagesStore.getState().send)(body, sentIds);
      setMention((current) => (current.text === sentText ? EMPTY_MENTION_STATE : current));
      uploads.discardSent(sentIds);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        setErrorText(caught.errors.body?.[0] ?? caught.errors.attachment_ids?.[0] ?? caught.message);
      } else if (caught instanceof ApiError && caught.status === 429) {
        setErrorText(t('channel.composer.rateLimited'));
      } else {
        setErrorText(t('channel.composer.sendFailed'));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.container}>
      {tooLong ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('channel.composer.tooLong', { max: MAX_MESSAGE_LENGTH })}
        </Text>
      ) : errorText !== null ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {errorText}
        </Text>
      ) : null}
      {suggestions.length > 0 ? (
        <View style={styles.suggestions}>
          {suggestions.map((member) => (
            <Pressable
              key={member.id}
              accessibilityRole="button"
              accessibilityLabel={t('channel.composer.mention', { name: member.name })}
              onPress={() => choose(member)}
              style={styles.suggestion}
            >
              <Text style={styles.suggestionText}>{member.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {uploads.items.length > 0 ? (
        <View accessibilityLabel={t('attachments.list')} style={styles.files}>
          {uploads.items.map((item) => (
            <View key={item.key} style={styles.file}>
              <View style={styles.fileInfo}>
                <Text numberOfLines={1} style={styles.fileName}>
                  {item.name}
                </Text>
                <Text style={item.status === 'error' ? styles.error : styles.fileMeta}>
                  {item.status === 'uploading'
                    ? t('attachments.uploading')
                    : item.status === 'error'
                      ? item.error
                      : item.size !== null
                        ? formatFileSize(item.size, i18n.language)
                        : t('attachments.ready')}
                </Text>
              </View>
              {item.status === 'error' && item.retryable ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('attachments.retryFile', { name: item.name })}
                  onPress={() => uploads.retry(item.key)}
                  style={styles.fileAction}
                >
                  <Text style={styles.fileActionText}>{t('attachments.retry')}</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(item.status === 'uploading' ? 'attachments.cancelFile' : 'attachments.removeFile', {
                  name: item.name,
                })}
                onPress={() => uploads.remove(item.key)}
                style={styles.fileAction}
              >
                <Text style={styles.fileActionText}>
                  {t(item.status === 'uploading' ? 'attachments.cancel' : 'attachments.remove')}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {menuOpen ? (
        <View style={styles.suggestions}>
          <Pressable accessibilityRole="button" onPress={() => void pick('media')} style={styles.suggestion}>
            <Text style={styles.suggestionText}>{t('attachments.pickMedia')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void pick('file')} style={styles.suggestion}>
            <Text style={styles.suggestionText}>{t('attachments.pickFile')}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('attachments.attach')}
          accessibilityState={{ disabled: !canAttach, expanded: menuOpen }}
          disabled={!canAttach}
          onPress={() => setMenuOpen((open) => !open)}
          style={[styles.attach, !canAttach && styles.sendDisabled]}
        >
          <Text style={styles.attachText}>+</Text>
        </Pressable>
        <TextInput
          multiline
          value={mention.text}
          onChangeText={(next) => setMention((current) => updateText(current, next))}
          selection={forcedSelection}
          onSelectionChange={(event) => {
            setForcedSelection(undefined);
            const { start, end } = event.nativeEvent.selection;
            setMention((current) => moveCaret(current, start, end));
          }}
          onBlur={() => setMention((current) => ({ ...current, caret: null }))}
          placeholder={placeholder ?? t('channel.composer.placeholder')}
          accessibilityLabel={placeholder ?? t('channel.composer.placeholder')}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={() => void submit()}
          style={[styles.send, !canSend && styles.sendDisabled]}
        >
          <Text style={styles.sendText}>{t('channel.composer.send')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  send: {
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  sendDisabled: { opacity: 0.4 },
  attach: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#888',
  },
  attachText: { fontSize: 22 },
  files: { gap: 4 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 14, fontWeight: '600' },
  fileMeta: { fontSize: 13, color: '#666' },
  fileAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  fileActionText: { color: '#2563eb', fontSize: 14 },
  sendText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  suggestions: { borderWidth: 1, borderColor: '#888', borderRadius: 8, overflow: 'hidden' },
  suggestion: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  suggestionText: { fontSize: 15 },
  error: { color: '#c0392b', fontSize: 14 },
});
