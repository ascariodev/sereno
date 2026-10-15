import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { buildGroupTaskDescription, TASK_TITLE_MAX_LENGTH, TaskCreateModal } from '@/components/TaskCreateModal';
import { getLogGroup, type LogGroup, LOG_LEVELS, useLogStore } from '@/log/store';
import {
  getLogGroupTask,
  setGroupStatus,
  setGroupTask,
  updateLogGroupStatus,
  useLogGroupsStore,
} from '@/messages/logGroups';
import { type LogGroupStatus, levelTone } from '@/messages/payload';
import { useProjectsStore } from '@/projects/store';

function eventText(group: LogGroup): string {
  const event = group.events?.[0];
  if (!event) return '';
  const context = event.context;
  if (context === null || (Array.isArray(context) ? context.length === 0 : Object.keys(context).length === 0)) {
    return event.message;
  }
  const lines = Array.isArray(context)
    ? [JSON.stringify(context, null, 2)]
    : Object.entries(context).map(([key, value]) => `${key}  ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return `${event.message}\n\n${lines.join('\n')}`;
}

export default function LogGroupDetail() {
  const { t, i18n } = useTranslation();
  const { projectId: rawProject, id: rawId } = useLocalSearchParams<{ projectId?: string; id?: string }>();
  const projectId = rawProject !== undefined && /^[1-9]\d*$/.test(rawProject) ? Number(rawProject) : null;
  const groupId = rawId !== undefined && /^[1-9]\d*$/.test(rawId) ? Number(rawId) : null;
  const project = useProjectsStore((state) => state.projects.find((item) => item.id === projectId));
  const canCreateTask = project !== undefined && project.archived_at == null;
  const sharedStatus = useLogGroupsStore((state) => (groupId === null ? undefined : state.statuses[groupId]));
  const sharedTask = useLogGroupsStore((state) => (groupId === null ? undefined : state.tasks[groupId]));
  const [group, setGroup] = useState<LogGroup | null>(null);
  const [loading, setLoading] = useState(projectId !== null && groupId !== null);
  const [error, setError] = useState<'failed' | 'notFound' | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; alert: boolean } | null>(null);
  const [creating, setCreating] = useState(false);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (projectId === null || groupId === null) return;
    let active = true;
    void (async () => {
      try {
        const loaded = await getLogGroup(projectId, groupId);
        if (active) setGroup(loaded);
      } catch (caught) {
        if (active) setError(caught instanceof ApiError && caught.status === 404 ? 'notFound' : 'failed');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, groupId, attempt]);

  function retry() {
    setLoading(true);
    setError(null);
    setAttempt((value) => value + 1);
  }

  const task = group?.task ?? sharedTask ?? null;

  async function act(status: LogGroupStatus) {
    if (pending || projectId === null || groupId === null) return;
    setPending(true);
    setNotice(null);
    try {
      const applied = await updateLogGroupStatus(projectId, groupId, status);
      setGroupStatus(groupId, applied);
      setGroup((current) => (current ? { ...current, status: applied } : current));
      useLogStore.getState().applyStatus(groupId, applied);
      void useLogStore.getState().refresh();
      useProjectsStore.getState().refreshCounts();
      setNotice({ text: t('notice.actions.marked', { status: t(`notice.status.${applied}`) }), alert: false });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        setNotice({ text: t('notice.actions.forbidden'), alert: true });
      } else if (caught instanceof ApiError && caught.status === 422) {
        setNotice({ text: caught.errors.status?.[0] ?? caught.message, alert: true });
      } else {
        setNotice({ text: t('notice.actions.failed'), alert: true });
      }
    } finally {
      setPending(false);
    }
  }

  async function groupTaken() {
    setCreating(false);
    if (projectId === null || groupId === null) return;
    try {
      const existing = await getLogGroupTask(projectId, groupId);
      if (!existing) throw new Error('no task');
      setGroupTask(groupId, existing);
      useLogStore.getState().setTask(groupId, existing);
      setNotice({ text: t('notice.actions.taskExists', { key: existing.key }), alert: false });
    } catch {
      setNotice({ text: t('notice.actions.taskExistsFailed'), alert: true });
    }
  }

  const formatDate = (value: string) =>
    new Date(value).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const status = sharedStatus ?? group?.status;
  const latest = group?.events?.[0] ?? null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {groupId === null ? t('logGroup.label') : t('logGroup.heading', { id: groupId })}
      </Text>
      {projectId === null || groupId === null ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('logGroup.notFound')}
        </Text>
      ) : loading ? (
        <View style={styles.block}>
          <ActivityIndicator />
          <Text accessibilityRole="progressbar">{t('common.loading')}</Text>
        </View>
      ) : error !== null || group === null ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {error === 'notFound' ? t('logGroup.notFound') : t('logGroup.loadFailed')}
          </Text>
          {error === 'failed' ? (
            <Pressable accessibilityRole="button" onPress={retry} style={styles.button}>
              <Text style={styles.buttonText}>{t('common.retry')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.pills}>
            <Text style={styles.pill}>{t(`notice.level.${levelTone(group.level)}`)}</Text>
            <Text style={styles.status}>{t(`notice.status.${status}`)}</Text>
          </View>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <Text style={styles.meta}>
            {t('logGroup.events')}: <Text testID="events-count">{group.events_count}</Text>
          </Text>
          <Text style={styles.meta}>
            {t('logGroup.firstSeen')}: {formatDate(group.first_seen_at)}
          </Text>
          <Text style={styles.meta}>
            {t('logGroup.lastSeen')}: {formatDate(group.last_seen_at)}
          </Text>
          <Text accessibilityRole="header" style={styles.heading}>
            {t('logGroup.lastEvent')}
          </Text>
          {latest?.source ? <Text style={styles.meta}>{t('logGroup.eventSource', { name: latest.source })}</Text> : null}
          {latest ? (
            <Text testID="latest-event" selectable style={styles.event}>
              {eventText(group)}
            </Text>
          ) : (
            <Text style={styles.meta}>{t('logGroup.noEvents')}</Text>
          )}
          <View style={styles.actions}>
            {status !== 'resolved' ? (
              <Pressable accessibilityRole="button" disabled={pending} onPress={() => void act('resolved')} style={styles.primary}>
                <Text style={styles.primaryText}>{t('notice.actions.resolve')}</Text>
              </Pressable>
            ) : null}
            {status !== 'ignored' ? (
              <Pressable accessibilityRole="button" disabled={pending} onPress={() => void act('ignored')} style={styles.button}>
                <Text style={styles.buttonText}>{t('notice.actions.ignore')}</Text>
              </Pressable>
            ) : null}
            {task ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push({ pathname: '/task', params: { projectId: String(projectId), id: String(task.id) } })}
                style={styles.button}
              >
                <Text style={styles.buttonText}>{t('logGroup.viewTask', { key: task.key })}</Text>
              </Pressable>
            ) : canCreateTask ? (
              <Pressable accessibilityRole="button" onPress={() => setCreating(true)} style={styles.button}>
                <Text style={styles.buttonText}>{t('logGroup.createTask')}</Text>
              </Pressable>
            ) : null}
          </View>
          {notice ? (
            <Text accessibilityRole={notice.alert ? 'alert' : undefined} style={notice.alert ? styles.error : styles.meta}>
              {notice.text}
            </Text>
          ) : null}
          {creating && canCreateTask ? (
            <TaskCreateModal
              projectId={projectId}
              groupId={group.id}
              initialTitle={[...group.title].slice(0, TASK_TITLE_MAX_LENGTH).join('')}
              initialDescription={buildGroupTaskDescription(
                { level: group.level, events_count: group.events_count, message: latest?.message ?? group.title },
                (key) => t(key),
                (LOG_LEVELS as readonly string[]).includes(group.level),
              )}
              onClose={() => setCreating(false)}
              onCreated={(created) => {
                setGroupTask(group.id, created);
                useLogStore.getState().setTask(group.id, created);
                setGroup({ ...group, task: created });
                setCreating(false);
              }}
              onGroupTaken={() => void groupTaken()}
            />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 15, fontWeight: '600', marginTop: 6 },
  block: { gap: 10 },
  error: { color: '#c0392b', fontSize: 14 },
  pills: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { fontSize: 11, fontWeight: '700', color: '#fff', backgroundColor: '#555', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  status: { fontSize: 13, color: '#444' },
  groupTitle: { fontSize: 15, fontWeight: '600', fontFamily: 'monospace' },
  meta: { fontSize: 13, color: '#555' },
  event: { fontSize: 12.5, fontFamily: 'monospace', padding: 10, borderRadius: 8, backgroundColor: '#f4f4f5' },
  actions: { gap: 8 },
  primary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', borderRadius: 8 },
  primaryText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#888' },
  buttonText: { fontSize: 16 },
});
