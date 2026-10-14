import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/client';
import { useMessagesStore } from '@/messages/store';
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

export function MessageComposer() {
  const { t } = useTranslation();
  const [mention, setMention] = useState<MentionState>(EMPTY_MENTION_STATE);
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | undefined>();
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const channelId = useMessagesStore((state) => state.channelId);
  const projectId = useProjectsStore((state) => {
    const entry = Object.entries(state.channelByProject).find(([, id]) => id === channelId);
    return entry ? Number(entry[0]) : null;
  });
  const members = useMemberDirectoryStore((state) => (projectId === null ? undefined : state.entries[projectId]?.members));
  const ownUserId = useAuthStore((state) => state.user?.id);

  const body = serializeMentions(mention);
  const tooLong = [...body].length > MAX_MESSAGE_LENGTH;
  const canSend = !sending && !tooLong && body.trim() !== '';
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

  async function submit() {
    if (!canSend) return;
    setSending(true);
    setErrorText(null);
    const sentText = mention.text;
    try {
      await useMessagesStore.getState().send(body);
      setMention((current) => (current.text === sentText ? EMPTY_MENTION_STATE : current));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        setErrorText(caught.errors.body?.[0] ?? caught.message);
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
      <View style={styles.row}>
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
          placeholder={t('channel.composer.placeholder')}
          accessibilityLabel={t('channel.composer.placeholder')}
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
  sendText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  suggestions: { borderWidth: 1, borderColor: '#888', borderRadius: 8, overflow: 'hidden' },
  suggestion: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  suggestionText: { fontSize: 15 },
  error: { color: '#c0392b', fontSize: 14 },
});
