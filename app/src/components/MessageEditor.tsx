import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { MAX_MESSAGE_LENGTH } from '@/components/MessageComposer';
import {
  findQuery,
  moveCaret,
  selectMember,
  serializeMentions,
  suggestionsFor,
  updateText,
  type MentionState,
} from '@/mentions/mentionInput';
import { parseMentionDraft } from '@/mentionToken';
import { type Message, useMessagesStore } from '@/messages/store';
import { useMemberDirectoryStore } from '@/projects/members';
import { useProjectsStore } from '@/projects/store';
import { useAuthStore } from '@/session/auth';

export function MessageEditor({ message, onDone }: { message: Message; onDone: () => void }) {
  const { t } = useTranslation();
  const [mention, setMention] = useState<MentionState>(() => parseMentionDraft(message.body ?? '', message.mentions));
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | undefined>();
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const projectId = useProjectsStore((state) => {
    const entry = Object.entries(state.channelByProject).find(([, id]) => id === message.channel_id);
    return entry ? Number(entry[0]) : null;
  });
  const members = useMemberDirectoryStore((state) => (projectId === null ? undefined : state.entries[projectId]?.members));
  const ownUserId = useAuthStore((state) => state.user?.id);

  const body = serializeMentions(mention);
  const tooLong = [...body].length > MAX_MESSAGE_LENGTH;
  const canSave = !saving && !tooLong && body.trim() !== '';
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

  async function save() {
    if (!canSave) return;
    if (body === (message.body ?? '')) {
      onDone();
      return;
    }
    setSaving(true);
    setErrorText(null);
    try {
      const response = await api.patch<{ data: Message }>(`/api/channels/${message.channel_id}/messages/${message.id}`, { body });
      useMessagesStore.getState().replace(response.data);
      onDone();
    } catch (caught) {
      const status = caught instanceof ApiError ? caught.status : 0;
      if (status === 422) setErrorText((caught as ApiError).errors.body?.[0] ?? (caught as ApiError).message);
      else if (status === 429) setErrorText(t('channel.composer.rateLimited'));
      else if (status === 403) setErrorText(t('message.editForbidden'));
      else if (status === 404) {
        setErrorText(t('message.editGone'));
        void useMessagesStore.getState().catchUp();
      }
      else setErrorText(t('message.editFailed'));
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <TextInput
        multiline
        autoFocus
        value={mention.text}
        onChangeText={(next) => {
          setErrorText(null);
          setMention((current) => updateText(current, next));
        }}
        selection={forcedSelection}
        onSelectionChange={(event) => {
          setForcedSelection(undefined);
          const { start, end } = event.nativeEvent.selection;
          setMention((current) => moveCaret(current, start, end));
        }}
        accessibilityLabel={t('message.editLabel')}
        style={styles.input}
      />
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
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" disabled={saving} onPress={onDone} style={styles.button}>
          <Text style={styles.buttonText}>{t('message.cancel')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          disabled={!canSave}
          onPress={() => void save()}
          style={[styles.button, styles.primary, !canSave && styles.disabled]}
        >
          <Text style={[styles.buttonText, styles.primaryText]}>{t('message.save')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  input: {
    minHeight: 44,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  bar: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#888',
  },
  buttonText: { fontSize: 15 },
  primary: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  primaryText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.4 },
  suggestions: { borderWidth: 1, borderColor: '#888', borderRadius: 8, overflow: 'hidden' },
  suggestion: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  suggestionText: { fontSize: 15 },
  error: { color: '#c0392b', fontSize: 14 },
});
