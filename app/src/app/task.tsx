import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/client';
import { TASK_DESCRIPTION_MAX_LENGTH, TASK_TITLE_MAX_LENGTH } from '@/components/TaskCreateModal';
import { MarkdownContent } from '@/markdown/MarkdownContent';
import { useMemberDirectoryStore } from '@/projects/members';
import { useProjectsStore } from '@/projects/store';
import { type Task, useTasksStore } from '@/tasks/store';

const FIELDS = ['title', 'description', 'assignee_id'] as const;
const charCount = (value: string) => [...value].length;
const parseId = (value: string | undefined) => (value !== undefined && /^[1-9]\d*$/.test(value) ? Number(value) : null);

interface FormValues {
  title: string;
  description: string | null;
  assigneeId: number | null;
}

interface FormProps {
  projectId: number;
  initial: { title: string; description: string; assigneeId: number | null; assignee?: Task['assignee'] };
  requireChange?: boolean;
  submitLabel: string;
  submittingLabel: string;
  failedMessage: string;
  onSubmit(values: FormValues): Promise<void>;
  onCancel(): void;
}

function TaskForm({ projectId, initial, requireChange = false, submitLabel, submittingLabel, failedMessage, onSubmit, onCancel }: FormProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [assigneeId, setAssigneeId] = useState<number | null>(initial.assigneeId);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const members = useMemberDirectoryStore((state) => state.entries[projectId]?.members);

  useEffect(() => {
    mounted.current = true;
    void useMemberDirectoryStore.getState().ensureLoaded(projectId);
    return () => {
      mounted.current = false;
    };
  }, [projectId]);

  const options = [...(members ?? [])];
  if (initial.assignee && !options.some((member) => member.id === initial.assignee?.id)) {
    options.push({ id: initial.assignee.id, name: initial.assignee.name });
  }
  const canSubmit = !requireChange || title !== initial.title || description !== initial.description || assigneeId !== initial.assigneeId;

  async function submit() {
    if (busy.current) return;
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
    busy.current = true;
    setSubmitting(true);
    try {
      await onSubmit({ title: trimmed, description: description.trim() === '' ? null : description.trim(), assigneeId });
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught;
      if (!mounted.current) return;
      if (caught.status === 422) {
        setErrors(caught.errors);
        if (!FIELDS.some((field) => caught.errors[field]?.length)) setFormError(caught.message);
      } else if (caught.status === 429) setFormError(t('taskCreate.tooManyAttempts'));
      else if (caught.status === 0) setFormError(t('taskCreate.network'));
      else setFormError(failedMessage);
    } finally {
      busy.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text style={styles.label}>{t('taskCreate.titleLabel')}</Text>
      <TextInput
        accessibilityLabel={t('taskCreate.titleLabel')}
        value={title}
        onChangeText={setTitle}
        editable={!submitting}
        style={styles.input}
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
        editable={!submitting}
        multiline
        style={[styles.input, styles.multiline]}
      />
      {errors.description?.map((message) => (
        <Text key={message} accessibilityRole="alert" style={styles.error}>
          {message}
        </Text>
      ))}
      <Text style={styles.label}>{t('taskCreate.assigneeLabel')}</Text>
      <View style={styles.options}>
        {[{ id: null, name: t('taskCreate.unassigned') }, ...options].map((option) => (
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
        <Pressable accessibilityRole="button" disabled={submitting} onPress={onCancel} style={styles.secondary}>
          <Text>{t('taskCreate.cancel')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: submitting || !canSubmit }}
          disabled={submitting || !canSubmit}
          onPress={() => void submit()}
          style={[styles.primary, !canSubmit && styles.disabled]}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : null}
          <Text style={styles.primaryText}>{submitting ? submittingLabel : submitLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function TaskScreen() {
  const { t } = useTranslation();
  const { projectId: rawProject, id: rawId } = useLocalSearchParams<{ projectId?: string; id?: string }>();
  const projectId = parseId(rawProject);
  const taskId = parseId(rawId);
  const creating = rawId === undefined;
  const archived = useProjectsStore((state) => state.projects.find((item) => item.id === projectId)?.archived_at != null);
  const task = useTasksStore((state) => (taskId === null ? undefined : state.tasks.find((item) => item.id === taskId)));
  const [lookedUp, setLookedUp] = useState(false);
  const [editing, setEditing] = useState(false);

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  useEffect(() => {
    if (projectId === null || taskId === null) return;
    let active = true;
    let opened = false;
    void (async () => {
      const store = useTasksStore.getState();
      if (store.projectId !== projectId) {
        opened = true;
        await store.open(projectId);
      }
      await useTasksStore.getState().ensure(projectId, taskId);
      if (active) setLookedUp(true);
    })();
    return () => {
      active = false;
      if (opened) useTasksStore.getState().clear();
    };
  }, [projectId, taskId]);

  if (projectId === null || (!creating && taskId === null)) {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="alert" style={styles.error}>
          {t('tasks.invalid')}
        </Text>
      </View>
    );
  }

  if (creating && archived) {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="alert" style={styles.error}>
          {t('taskCreate.archived')}
        </Text>
        <Pressable accessibilityRole="button" onPress={close} style={styles.secondary}>
          <Text>{t('taskAside.close')}</Text>
        </Pressable>
      </View>
    );
  }

  if (creating) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('taskCreate.title')}
        </Text>
        <TaskForm
          projectId={projectId}
          initial={{ title: '', description: '', assigneeId: null }}
          submitLabel={t('taskCreate.submit')}
          submittingLabel={t('taskCreate.creating')}
          failedMessage={t('taskCreate.failed')}
          onSubmit={async (values) => {
            await useTasksStore.getState().create(projectId, { ...values, status: 'todo' });
            close();
          }}
          onCancel={close}
        />
      </ScrollView>
    );
  }

  if (!task) {
    return (
      <View style={styles.centered}>
        {lookedUp ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {t('taskAside.notFound')}
          </Text>
        ) : (
          <>
            <ActivityIndicator />
            <Text accessibilityRole="progressbar">{t('common.loading')}</Text>
          </>
        )}
        <Pressable accessibilityRole="button" onPress={close} style={styles.secondary}>
          <Text>{t('taskAside.close')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.key}>{task.key}</Text>
      {editing ? (
        <TaskForm
          projectId={projectId}
          initial={{
            title: task.title,
            description: task.description ?? '',
            assigneeId: task.assignee?.id ?? null,
            assignee: task.assignee,
          }}
          requireChange
          submitLabel={t('taskAside.save')}
          submittingLabel={t('taskAside.saving')}
          failedMessage={t('taskAside.failed')}
          onSubmit={async (values) => {
            await useTasksStore.getState().update(projectId, task.id, values);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <Text accessibilityRole="header" style={styles.title}>
            {task.title}
          </Text>
          <Text style={styles.meta}>{t(`tasks.status.${task.status}`)}</Text>
          <Text style={styles.meta}>
            {task.assignee ? t('tasks.assignedTo', { name: task.assignee.name }) : t('tasks.unassigned')}
          </Text>
          {task.log_group ? <Text style={styles.meta}>{t('tasks.fromNotice')}</Text> : null}
          {task.description && task.description.trim() !== '' ? (
            <View testID="task-description">
              <MarkdownContent source={task.description} />
            </View>
          ) : (
            <Text style={styles.meta}>{t('taskAside.noDescription')}</Text>
          )}
          <Pressable accessibilityRole="button" onPress={() => setEditing(true)} style={styles.secondary}>
            <Text>{t('taskAside.edit')}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 10 },
  centered: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
  key: { fontSize: 12, fontWeight: '700', color: '#555' },
  meta: { fontSize: 13, color: '#555' },
  form: { gap: 8 },
  label: { fontSize: 13, color: '#444' },
  input: { borderWidth: 1, borderColor: '#aaa', borderRadius: 8, padding: 10, fontSize: 15 },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  error: { color: '#c0392b', fontSize: 13 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: '#aaa', borderRadius: 22 },
  optionSelected: { backgroundColor: '#111', borderColor: '#111' },
  optionSelectedText: { color: '#fff' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 },
  secondary: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#888', borderRadius: 8 },
  primary: { minHeight: 44, paddingHorizontal: 14, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', borderRadius: 8 },
  disabled: { opacity: 0.5 },
  primaryText: { color: '#fff', fontWeight: '600' },
});
