import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { buildGroupTaskDescription, TASK_TITLE_MAX_LENGTH, TaskCreateModal } from '@/components/TaskCreateModal';
import {
  getLogGroupTask,
  setGroupStatus,
  setGroupTask,
  updateLogGroupStatus,
  useLogGroupsStore,
} from '@/messages/logGroups';
import {
  type LogGroupStatus,
  isLogGroupOpenedPayload,
  isLogGroupStatusChangedPayload,
  isTaskCreatedFromGroupPayload,
  isTaskGroupReopenedPayload,
  levelTone,
} from '@/messages/payload';
import type { Message } from '@/messages/store';
import { useProjectsStore } from '@/projects/store';

const TONE_COLORS: Record<string, string> = {
  debug: '#6b7280',
  info: '#2563eb',
  notice: '#0891b2',
  warning: '#d97706',
  error: '#dc2626',
  critical: '#b91c1c',
  alert: '#9f1239',
  emergency: '#7f1d1d',
};

function useProjectOf(channelId: number): { id: number; archived: boolean } | null {
  const id = useProjectsStore((state) => {
    const entry = Object.entries(state.channelByProject).find(([, channel]) => channel === channelId);
    return entry && state.projects.some((item) => item.id === Number(entry[0])) ? Number(entry[0]) : null;
  });
  const archived = useProjectsStore((state) => state.projects.find((item) => item.id === id)?.archived_at != null);
  return id === null ? null : { id, archived };
}

export function SystemNotice({ message }: { message: Message }) {
  const { t, i18n } = useTranslation();
  const payload = message.payload;
  const groupId = isLogGroupOpenedPayload(payload) ? payload.log_group_id : null;
  const project = useProjectOf(message.channel_id);
  const sharedStatus = useLogGroupsStore((state) => (groupId === null ? undefined : state.statuses[groupId]));
  const groupTask = useLogGroupsStore((state) => (groupId === null ? undefined : state.tasks[groupId]));
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; alert: boolean } | null>(null);
  const [creating, setCreating] = useState(false);

  async function act(status: LogGroupStatus) {
    if (pending || project === null || groupId === null) return;
    setPending(true);
    setNotice(null);
    try {
      setGroupStatus(groupId, await updateLogGroupStatus(project.id, groupId, status));
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
    if (project === null || groupId === null) return;
    try {
      const task = await getLogGroupTask(project.id, groupId);
      if (!task) throw new Error('no task');
      setGroupTask(groupId, task);
      setNotice({ text: t('notice.actions.taskExists', { key: task.key }), alert: false });
    } catch {
      setNotice({ text: t('notice.actions.taskExistsFailed'), alert: true });
    }
  }
  const time = new Date(message.created_at).toLocaleTimeString(i18n.language, { timeStyle: 'short' });
  const actor = message.user?.name ?? t('notice.unknownActor');
  const status = (value: string) => (i18n.exists(`notice.status.${value}`) ? t(`notice.status.${value}`) : value);

  if (isLogGroupOpenedPayload(payload)) {
    const tone = levelTone(payload.level);
    const color = TONE_COLORS[tone];
    return (
      <View testID="system-notice" style={[styles.card, { borderLeftColor: color }]}>
        <View style={styles.head}>
          <Text style={[styles.pill, { backgroundColor: color }]}>
            {i18n.exists(`notice.level.${tone}`) ? t(`notice.level.${tone}`) : payload.level}
          </Text>
          <Text style={styles.kind}>
            {payload.type === 'log.group_reopened' ? t('notice.reopenedLabel') : t('notice.openedLabel')}
          </Text>
          {groupTask ? (
            <Pressable
              testID="notice-task-chip"
              accessibilityRole="link"
              disabled={project === null}
              onPress={() =>
                project !== null && router.push({ pathname: '/tasks', params: { projectId: String(project.id) } })
              }
            >
              <Text style={styles.chip}>{t('notice.taskChip', { key: groupTask.key })}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.time}>{time}</Text>
        </View>
        <Text style={styles.title}>{payload.title}</Text>
        <Text style={styles.stats}>
          {payload.events_count} {t('notice.eventsWord', { count: payload.events_count })}
        </Text>
        {sharedStatus && sharedStatus !== 'open' ? (
          <Text style={styles.stats}>{t('notice.actions.marked', { status: status(sharedStatus) })}</Text>
        ) : project !== null ? (
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" disabled={pending} onPress={() => void act('resolved')} style={styles.primary}>
              <Text style={styles.primaryText}>{t('notice.actions.resolve')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={pending} onPress={() => void act('ignored')} style={styles.secondary}>
              <Text>{t('notice.actions.ignore')}</Text>
            </Pressable>
            {!groupTask && !project.archived ? (
              <Pressable accessibilityRole="button" onPress={() => setCreating(true)} style={styles.secondary}>
                <Text>{t('logGroup.createTask')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {notice ? (
          <Text accessibilityRole={notice.alert ? 'alert' : undefined} style={notice.alert ? styles.error : styles.stats}>
            {notice.text}
          </Text>
        ) : null}
        {creating && project !== null ? (
          <TaskCreateModal
            projectId={project.id}
            groupId={payload.log_group_id}
            initialTitle={[...payload.title].slice(0, TASK_TITLE_MAX_LENGTH).join('')}
            initialDescription={buildGroupTaskDescription(
              { level: payload.level, events_count: payload.events_count, message: payload.title },
              (key) => t(key),
              i18n.exists(`notice.level.${payload.level}`),
            )}
            onClose={() => setCreating(false)}
            onCreated={(task) => {
              setGroupTask(payload.log_group_id, task);
              setCreating(false);
            }}
            onGroupTaken={() => void groupTaken()}
          />
        ) : null}
      </View>
    );
  }

  if (isLogGroupStatusChangedPayload(payload)) {
    const title = payload.title?.trim();
    const text = title
      ? t('notice.statusChangedTitled', { actor, title, status: status(payload.status) })
      : t('notice.statusChanged', { actor, status: status(payload.status) });
    return <Line text={text} time={time} />;
  }

  if (isTaskCreatedFromGroupPayload(payload)) {
    return <Line text={t('notice.taskCreated', { actor, task: payload.task_key })} time={time} />;
  }

  if (isTaskGroupReopenedPayload(payload)) {
    return <Line text={t('notice.taskGroupReopened', { task: payload.task_key })} time={time} />;
  }

  return <Text style={styles.generic}>{t('channel.systemNotice')}</Text>;
}

function Line({ text, time }: { text: string; time: string }) {
  return (
    <View testID="system-notice-line" style={styles.line}>
      <Text style={styles.lineText}>{text}</Text>
      <Text style={styles.time}>{time}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6, padding: 12, borderWidth: 1, borderColor: '#ddd', borderLeftWidth: 4, borderRadius: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pill: { color: '#fff', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  kind: { fontSize: 13, color: '#444' },
  time: { fontSize: 12, color: '#777', marginLeft: 'auto' },
  title: { fontSize: 13, fontWeight: '500', fontFamily: 'monospace' },
  stats: { fontSize: 12.5, color: '#444' },
  chip: { fontSize: 12, fontWeight: '500', backgroundColor: '#eef', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primary: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', borderRadius: 8 },
  primaryText: { color: '#fff', fontWeight: '600' },
  secondary: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#888', borderRadius: 8 },
  error: { color: '#c0392b', fontSize: 12.5 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  lineText: { fontSize: 13, color: '#444', flexShrink: 1 },
  generic: { color: '#777' },
});
