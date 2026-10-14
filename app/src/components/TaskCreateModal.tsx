import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/client';
import { createTaskFromGroup, type LogGroupTask } from '@/messages/logGroups';
import { useMemberDirectoryStore } from '@/projects/members';

export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_DESCRIPTION_MAX_LENGTH = 10000;

const charCount = (value: string) => [...value].length;

function fenceFor(message: string): string {
  const longestRun = Math.max(0, ...(message.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longestRun + 1));
}

export function buildGroupTaskDescription(
  data: { level: string; events_count: number; message: string },
  t: (key: string) => string,
  levelKnown: boolean,
): string {
  const level = levelKnown ? t(`notice.level.${data.level}`) : data.level;
  const head = `- **${t('logGroup.levelLabel')}:** ${level}\n- **${t('logGroup.events')}:** ${data.events_count}\n\n`;
  const build = (message: string) => {
    const fence = fenceFor(message);
    return `${head}${fence}\n${message}\n${fence}`;
  };
  const full = build(data.message);
  const overflow = charCount(full) - TASK_DESCRIPTION_MAX_LENGTH;
  if (overflow <= 0) return full;
  const chars = [...data.message];
  return build(`${chars.slice(0, Math.max(0, chars.length - overflow - 1)).join('')}…`);
}

interface Props {
  projectId: number;
  groupId: number;
  initialTitle: string;
  initialDescription: string;
  onClose(): void;
  onCreated(task: LogGroupTask): void;
  onGroupTaken(): void;
}

export function TaskCreateModal({ projectId, groupId, initialTitle, initialDescription, onClose, onCreated, onGroupTaken }: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const members = useMemberDirectoryStore((state) => state.entries[projectId]?.members);

  useEffect(() => {
    void useMemberDirectoryStore.getState().ensureLoaded(projectId);
  }, [projectId]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function submit() {
    if (submitting) return;
    setFormError(null);
    const local: Record<string, string[]> = {};
    const trimmed = title.trim();
    if (trimmed === '') local.title = [t('taskCreate.titleRequired')];
    else if (charCount(trimmed) > TASK_TITLE_MAX_LENGTH) local.title = [t('taskCreate.titleTooLong', { max: TASK_TITLE_MAX_LENGTH })];
    if (charCount(description.trim()) > TASK_DESCRIPTION_MAX_LENGTH) {
      local.description = [t('taskCreate.descriptionTooLong', { max: TASK_DESCRIPTION_MAX_LENGTH })];
    }
    setErrors(local);
    if (Object.keys(local).length > 0) return;
    setSubmitting(true);
    try {
      const task = await createTaskFromGroup(projectId, {
        title: trimmed,
        description: description.trim() === '' ? null : description.trim(),
        logGroupId: groupId,
        assigneeId,
      });
      onCreated(task);
    } catch (caught) {
      setSubmitting(false);
      if (!(caught instanceof ApiError)) throw caught;
      if (caught.status === 422 && caught.errors.log_group_id?.length) {
        onGroupTaken();
      } else if (caught.status === 422) {
        setErrors(caught.errors);
        if (!['title', 'description', 'assignee_id'].some((field) => caught.errors[field]?.length)) setFormError(caught.message);
      } else if (caught.status === 429) {
        setFormError(t('taskCreate.tooManyAttempts'));
      } else if (caught.status === 0) {
        setFormError(t('taskCreate.network'));
      } else {
        setFormError(t('taskCreate.failed'));
      }
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => !submitting && onClose()}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.heading}>
            {t('taskCreate.title')}
          </Text>
          <Text style={styles.label}>{t('taskCreate.titleLabel')}</Text>
          <TextInput
            accessibilityLabel={t('taskCreate.titleLabel')}
            value={title}
            onChangeText={setTitle}
            style={styles.input}
            editable={!submitting}
          />
          {errors.title?.map((message) => (
            <Text key={message} accessibilityRole="alert" style={styles.error}>
              {message}
            </Text>
          ))}
          <Text style={styles.label}>{t('taskCreate.descriptionLabel')}</Text>
          <TextInput
            accessibilityLabel={t('taskCreate.descriptionLabel')}
            value={description}
            onChangeText={setDescription}
            multiline
            style={[styles.input, styles.multiline]}
            editable={!submitting}
          />
          {errors.description?.map((message) => (
            <Text key={message} accessibilityRole="alert" style={styles.error}>
              {message}
            </Text>
          ))}
          <Text style={styles.label}>{t('taskCreate.assigneeLabel')}</Text>
          <View style={styles.options}>
            {[{ id: null, name: t('taskCreate.unassigned') }, ...(members ?? [])].map((option) => (
              <Pressable
                key={option.id ?? 'none'}
                accessibilityRole="radio"
                accessibilityState={{ selected: assigneeId === option.id }}
                disabled={submitting}
                onPress={() => setAssigneeId(option.id)}
                style={[styles.option, assigneeId === option.id && styles.optionSelected]}
              >
                <Text style={assigneeId === option.id ? styles.optionSelectedText : undefined}>{option.name}</Text>
              </Pressable>
            ))}
          </View>
          {errors.assignee_id?.map((message) => (
            <Text key={message} accessibilityRole="alert" style={styles.error}>
              {message}
            </Text>
          ))}
          {formError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {formError}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" disabled={submitting} onPress={onClose} style={styles.secondary}>
              <Text>{t('taskCreate.cancel')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={submitting} onPress={() => void submit()} style={styles.primary}>
              {submitting ? <ActivityIndicator color="#fff" /> : null}
              <Text style={styles.primaryText}>{submitting ? t('taskCreate.creating') : t('taskCreate.submit')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: 10, padding: 16, gap: 8 },
  heading: { fontSize: 18, fontWeight: '700' },
  label: { fontSize: 13, color: '#444' },
  input: { borderWidth: 1, borderColor: '#aaa', borderRadius: 8, padding: 10, fontSize: 15 },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  error: { color: '#c0392b', fontSize: 13 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: { minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: '#aaa', borderRadius: 18 },
  optionSelected: { backgroundColor: '#111', borderColor: '#111' },
  optionSelectedText: { color: '#fff' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 },
  secondary: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#888', borderRadius: 8 },
  primary: { minHeight: 44, paddingHorizontal: 14, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', borderRadius: 8 },
  primaryText: { color: '#fff', fontWeight: '600' },
});
