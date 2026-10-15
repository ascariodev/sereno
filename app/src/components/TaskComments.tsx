import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/client';
import { MessageAttachments } from '@/components/MessageAttachments';
import { relativeTime } from '@/components/ThreadSummary';
import { MarkdownContent } from '@/markdown/MarkdownContent';
import {
  ATTACHMENT_MAX_PER_MESSAGE,
  formatFileSize,
  getTaskAttachmentUrl,
  taskAttachmentsPath,
  toPickedFile,
  type PickedFile,
} from '@/messages/attachments';
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
import { parseMentionDraft } from '@/mentionToken';
import { useOrganizationStore } from '@/organization/store';
import { useMemberDirectoryStore } from '@/projects/members';
import { useAuthStore } from '@/session/auth';
import { COMMENT_MAX_LENGTH, type TaskComment, useTaskCommentsStore } from '@/tasks/comments';

interface MentionFieldProps {
  projectId: number;
  state: MentionState;
  onChange(update: (current: MentionState) => MentionState): void;
  label: string;
  editable: boolean;
  autoFocus?: boolean;
}

function MentionField({ projectId, state, onChange, label, editable, autoFocus }: MentionFieldProps) {
  const { t } = useTranslation();
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | undefined>();
  const members = useMemberDirectoryStore((s) => s.entries[projectId]?.members);
  const ownUserId = useAuthStore((s) => s.user?.id);
  const suggestions = suggestionsFor(state, members ?? [], ownUserId);
  const querying = findQuery(state) !== null;

  useEffect(() => {
    if (querying) void useMemberDirectoryStore.getState().ensureLoaded(projectId);
  }, [querying, projectId]);

  function choose(member: { id: number; name: string }) {
    const next = selectMember(state, member);
    onChange(() => next);
    if (next.caret !== null) setForcedSelection({ start: next.caret, end: next.caret });
  }

  return (
    <View style={styles.field}>
      <TextInput
        multiline
        autoFocus={autoFocus}
        editable={editable}
        value={state.text}
        onChangeText={(next) => onChange((current) => updateText(current, next))}
        selection={forcedSelection}
        onSelectionChange={(event) => {
          setForcedSelection(undefined);
          const { start, end } = event.nativeEvent.selection;
          onChange((current) => moveCaret(current, start, end));
        }}
        onBlur={() => onChange((current) => ({ ...current, caret: null }))}
        accessibilityLabel={label}
        placeholder={label}
        style={styles.input}
      />
      {suggestions.length > 0 ? (
        <View style={styles.suggestions}>
          {suggestions.map((member) => (
            <Pressable
              key={member.id}
              accessibilityRole="button"
              accessibilityLabel={t('channel.composer.mention', {
                name: member.name,
              })}
              onPress={() => choose(member)}
              style={styles.suggestion}
            >
              <Text>{member.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CommentEditor({ projectId, comment, onDone }: { projectId: number; comment: TaskComment; onDone(): void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<MentionState>(() => parseMentionDraft(comment.body, comment.mentions));
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const body = serializeMentions(state).trim();
  const tooLong = [...body].length > COMMENT_MAX_LENGTH;
  const canSave = !saving && !tooLong && body !== '' && body !== comment.body.trim();

  async function save() {
    if (!canSave || busy.current) return;
    busy.current = true;
    setSaving(true);
    setErrorText(null);
    try {
      await useTaskCommentsStore.getState().update(projectId, comment.task_id, comment.id, body);
      if (mounted.current) onDone();
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught;
      if (!mounted.current) return;
      if (caught.status === 422) setErrorText(caught.errors.body?.[0] ?? caught.message);
      else if (caught.status === 429) setErrorText(t('taskComments.tooManyAttempts'));
      else if (caught.status === 0) setErrorText(t('taskComments.network'));
      else if (caught.status === 403) setErrorText(t('taskComments.editForbidden'));
      else if (caught.status === 404) setErrorText(t('taskComments.editGone'));
      else setErrorText(t('taskComments.editFailed'));
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <View style={styles.field}>
      <MentionField
        projectId={projectId}
        state={state}
        onChange={(update) => {
          setErrorText(null);
          setState(update);
        }}
        label={t('taskComments.editLabel')}
        editable={!saving}
        autoFocus
      />
      {tooLong ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('taskComments.tooLong', { max: COMMENT_MAX_LENGTH })}
        </Text>
      ) : errorText !== null ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {errorText}
        </Text>
      ) : null}
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" disabled={saving} onPress={onDone} style={styles.secondary}>
          <Text>{t('message.cancel')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          disabled={!canSave}
          onPress={() => void save()}
          style={[styles.primary, !canSave && styles.disabled]}
        >
          <Text style={styles.primaryText}>{saving ? t('taskComments.saving') : t('message.save')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CommentRow({ projectId, comment }: { projectId: number; comment: TaskComment }) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mounted = useRef(true);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const moderator = useOrganizationStore((s) => s.canModerate());
  const own = comment.user?.id === userId;
  const name = comment.user?.name ?? t('taskComments.deletedUser');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function destroy() {
    if (deleting) return;
    setDeleting(true);
    try {
      await useTaskCommentsStore.getState().destroy(projectId, comment.task_id, comment.id);
    } catch (caught) {
      const status = caught instanceof ApiError ? caught.status : 0;
      if (status === 404) useTaskCommentsStore.getState().remove(comment.id);
      else if (status === 403) Alert.alert(t('taskComments.deleteForbidden'));
      else if (status === 0) Alert.alert(t('taskComments.network'));
      else Alert.alert(t('taskComments.deleteFailed'));
    } finally {
      if (mounted.current) setDeleting(false);
    }
  }

  function confirmDelete() {
    Alert.alert(t('taskComments.deleteTitle'), t('taskComments.deleteConfirm'), [
      { text: t('taskComments.deleteCancel'), style: 'cancel' },
      {
        text: t('taskComments.delete'),
        style: 'destructive',
        onPress: () => void destroy(),
      },
    ]);
  }

  return (
    <View testID="task-comment" style={styles.comment}>
      <View style={styles.head}>
        <Text style={styles.author}>{name}</Text>
        <Text style={styles.time}>{relativeTime(comment.created_at, i18n.language)}</Text>
        {comment.edited_at ? <Text style={styles.time}>{t('message.edited')}</Text> : null}
      </View>
      {editing ? (
        <CommentEditor projectId={projectId} comment={comment} onDone={() => setEditing(false)} />
      ) : (
        <>
          <MarkdownContent source={comment.body} mentions={comment.mentions} ownUserId={userId ?? undefined} />
          <MessageAttachments attachments={comment.attachments} renewUrl={getTaskAttachmentUrl} />
        </>
      )}
      {!editing && (own || moderator) ? (
        <View style={styles.bar}>
          {own ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('taskComments.editNamed', { name })}
              onPress={() => setEditing(true)}
              style={styles.link}
            >
              <Text style={styles.linkText}>{t('taskComments.edit')}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('taskComments.deleteNamed', { name })}
            disabled={deleting}
            onPress={confirmDelete}
            style={styles.link}
          >
            <Text style={styles.dangerText}>{t('taskComments.delete')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function TaskComments({ projectId, taskId }: { projectId: number; taskId: number }) {
  const { t, i18n } = useTranslation();
  const comments = useTaskCommentsStore((s) => s.comments);
  const nextCursor = useTaskCommentsStore((s) => s.nextCursor);
  const loading = useTaskCommentsStore((s) => s.loading);
  const loadingMore = useTaskCommentsStore((s) => s.loadingMore);
  const failed = useTaskCommentsStore((s) => s.failed);
  const [draft, setDraft] = useState<MentionState>(EMPTY_MENTION_STATE);
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  // Keyed by task: changing task drops the uploads still in flight.
  const uploads = useAttachmentUploads(taskId, {
    path: taskAttachmentsPath(projectId, taskId),
    tooManyKey: 'taskComments.tooManyAttachments',
  });

  useEffect(() => {
    mounted.current = true;
    void useTaskCommentsStore.getState().open(projectId, taskId);
    return () => {
      mounted.current = false;
      useTaskCommentsStore.getState().clear();
    };
  }, [projectId, taskId]);

  const body = serializeMentions(draft).trim();
  const tooLong = [...body].length > COMMENT_MAX_LENGTH;
  const canSend = !sending && !uploads.busy && !tooLong && body !== '';
  const canAttach = !picking && !sending && !uploads.full;

  async function submit() {
    if (!canSend || busy.current) return;
    busy.current = true;
    setSending(true);
    setErrorText(null);
    const sentText = draft.text;
    const sentIds = [...uploads.attachmentIds];
    try {
      await useTaskCommentsStore.getState().send(body, sentIds);
      if (mounted.current) {
        setDraft((current) => (current.text === sentText ? EMPTY_MENTION_STATE : current));
        uploads.discardSent(sentIds);
      }
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught;
      if (!mounted.current) return;
      if (caught.status === 422) setErrorText(caught.errors.body?.[0] ?? caught.message);
      else if (caught.status === 429) setErrorText(t('taskComments.tooManyAttempts'));
      else if (caught.status === 0) setErrorText(t('taskComments.network'));
      else setErrorText(t('taskComments.sendFailed'));
    } finally {
      busy.current = false;
      if (mounted.current) setSending(false);
    }
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
      if (mounted.current) setErrorText(t('attachments.pickFailed'));
    } finally {
      if (mounted.current) setPicking(false);
    }
  }

  function retry() {
    const store = useTaskCommentsStore.getState();
    if (store.comments.length === 0) void store.open(projectId, taskId);
    else void store.loadOlder();
  }

  return (
    <View testID="task-comments" style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t('taskComments.heading')}
      </Text>
      {loading ? (
        <View style={styles.row}>
          <ActivityIndicator />
          <Text accessibilityRole="progressbar">{t('common.loading')}</Text>
        </View>
      ) : null}
      {failed ? (
        <View style={styles.field}>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('taskComments.loadFailed')}
          </Text>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.secondary}>
            <Text>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}
      {!loading && !failed && comments.length === 0 ? <Text style={styles.time}>{t('taskComments.empty')}</Text> : null}
      {nextCursor !== null && !loading && !failed ? (
        <Pressable
          accessibilityRole="button"
          disabled={loadingMore}
          onPress={() => void useTaskCommentsStore.getState().loadOlder()}
          style={styles.secondary}
        >
          <Text>{loadingMore ? t('common.loading') : t('taskComments.loadOlder')}</Text>
        </Pressable>
      ) : null}
      {comments.map((comment) => (
        <CommentRow key={comment.id} projectId={projectId} comment={comment} />
      ))}
      <MentionField
        projectId={projectId}
        state={draft}
        onChange={(update) => {
          setErrorText(null);
          setDraft(update);
        }}
        label={t('taskComments.newLabel')}
        editable={!sending}
      />
      {tooLong ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('taskComments.tooLong', { max: COMMENT_MAX_LENGTH })}
        </Text>
      ) : errorText !== null ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {errorText}
        </Text>
      ) : null}
      {uploads.items.length > 0 ? (
        <View accessibilityLabel={t('attachments.list')} style={styles.field}>
          {uploads.items.map((item) => (
            <View key={item.key} style={styles.file}>
              <View style={styles.fileInfo}>
                <Text numberOfLines={1} style={styles.author}>
                  {item.name}
                </Text>
                <Text style={item.status === 'error' ? styles.error : styles.time}>
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
                  style={styles.link}
                >
                  <Text style={styles.linkText}>{t('attachments.retry')}</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(item.status === 'uploading' ? 'attachments.cancelFile' : 'attachments.removeFile', {
                  name: item.name,
                })}
                onPress={() => uploads.remove(item.key)}
                style={styles.link}
              >
                <Text style={styles.linkText}>
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
            <Text>{t('attachments.pickMedia')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void pick('file')} style={styles.suggestion}>
            <Text>{t('attachments.pickFile')}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('attachments.attach')}
          accessibilityState={{ disabled: !canAttach, expanded: menuOpen }}
          disabled={!canAttach}
          onPress={() => setMenuOpen((open) => !open)}
          style={[styles.secondary, !canAttach && styles.disabled]}
        >
          <Text>+</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={() => void submit()}
          style={[styles.primary, !canSend && styles.disabled]}
        >
          <Text style={styles.primaryText}>{sending ? t('taskComments.sending') : t('taskComments.send')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 16 },
  heading: { fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  field: { gap: 6 },
  comment: { gap: 4 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  author: { fontSize: 14, fontWeight: '600' },
  time: { fontSize: 12, color: '#777' },
  input: {
    minHeight: 44,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: '#aaa',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  suggestions: {
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 8,
    overflow: 'hidden',
  },
  suggestion: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  file: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fileInfo: { flex: 1 },
  bar: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  link: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  linkText: { color: '#2563eb', fontSize: 14 },
  dangerText: { color: '#c0392b', fontSize: 14 },
  secondary: {
    minHeight: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 8,
  },
  primary: {
    minHeight: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
    borderRadius: 8,
  },
  primaryText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  error: { color: '#c0392b', fontSize: 13 },
});
