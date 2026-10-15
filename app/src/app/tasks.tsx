import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TaskMoveMenu } from '@/components/TaskMoveMenu'
import { useProjectsStore } from '@/projects/store';
import { useAuthStore } from '@/session/auth';
import { TASK_FILTERS, TASK_STATUSES, type Task, type TaskColumns, toColumns, useTasksStore } from '@/tasks/store';

function TaskCard({ task, columns, canMove }: { task: Task; columns: TaskColumns; canMove: boolean }) {
  const { t } = useTranslation();
  const comments = task.comments_count ?? 0;
  return (
    <View style={styles.cardWrap}>
    <Pressable
      testID={`task-${task.id}`}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/task', params: { projectId: String(task.project_id), id: String(task.id) } })}
      style={styles.card}
    >
      <Text style={styles.key}>{task.key}</Text>
      <Text style={styles.taskTitle}>{task.title}</Text>
      <Text style={styles.meta}>
        {task.assignee ? t('tasks.assignedTo', { name: task.assignee.name }) : t('tasks.unassigned')}
      </Text>
      {task.log_group ? <Text style={styles.meta}>{t('tasks.fromNotice')}</Text> : null}
      {comments > 0 ? <Text style={styles.meta}>{t('tasks.commentsCount', { count: comments })}</Text> : null}
    </Pressable>
    {canMove ? <TaskMoveMenu task={task} columns={columns} /> : null}
    </View>
  );
}

export default function Tasks() {
  const { t } = useTranslation();
  const { projectId: rawId, name } = useLocalSearchParams<{ projectId?: string; name?: string }>();
  const projectId = rawId !== undefined && /^[1-9]\d*$/.test(rawId) ? Number(rawId) : null;
  const projectName = useProjectsStore((state) => state.projects.find((item) => item.id === projectId)?.name);
  const archived = useProjectsStore((state) => state.projects.find((item) => item.id === projectId)?.archived_at != null);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const { tasks, loading, failed, filter, hasMoreDone, doneTotal, loadingMoreDone, open, showMoreDone, setFilter } =
    useTasksStore();

  useEffect(() => {
    if (projectId !== null) void useTasksStore.getState().open(projectId);
    return () => useTasksStore.getState().clear();
  }, [projectId]);

  const columns = useMemo(() => toColumns(tasks, filter, userId), [tasks, filter, userId]);
  const fullColumns = useMemo(() => toColumns(tasks), [tasks]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {projectName ?? name ?? t('tasks.title')}
      </Text>
      {projectId === null ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('tasks.invalid')}
        </Text>
      ) : loading ? (
        <View style={styles.block}>
          <ActivityIndicator />
          <Text accessibilityRole="progressbar">{t('common.loading')}</Text>
        </View>
      ) : failed ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('tasks.loadFailed')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void open(projectId)} style={styles.button}>
            <Text style={styles.buttonText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {archived ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/task', params: { projectId: String(projectId) } })}
              style={styles.button}
            >
              <Text style={styles.buttonText}>{t('tasks.newTask')}</Text>
            </Pressable>
          )}
          <View accessibilityLabel={t('tasks.filtersLabel')} style={styles.filters}>
            {TASK_FILTERS.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === item }}
                onPress={() => setFilter(item)}
                style={[styles.chip, filter === item && styles.chipActive]}
              >
                <Text style={filter === item ? styles.chipActiveText : undefined}>{t(`tasks.filters.${item}`)}</Text>
              </Pressable>
            ))}
          </View>
          {TASK_STATUSES.map((status) => {
            const shown = columns[status].length;
            const count = status === 'done' && hasMoreDone && filter === 'all' ? (doneTotal ?? shown) : shown;
            return (
              <View key={status} testID={`column-${status}`} style={styles.column}>
                <Text accessibilityRole="header" style={styles.columnTitle}>
                  {t(`tasks.status.${status}`)} ({count})
                </Text>
                {status === 'done' && hasMoreDone ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={loadingMoreDone}
                    onPress={() => void showMoreDone()}
                    style={styles.button}
                  >
                    <Text style={styles.buttonText}>{t('tasks.showMoreDone')}</Text>
                  </Pressable>
                ) : null}
                {shown === 0 ? <Text style={styles.meta}>{t('tasks.empty')}</Text> : null}
                {columns[status].map((task) => (
                  <TaskCard key={task.id} task={task} columns={fullColumns} canMove={!archived} />
                ))}
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  block: { gap: 10 },
  error: { color: '#c0392b', fontSize: 14 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: '#888' },
  chipActive: { backgroundColor: '#111', borderColor: '#111' },
  chipActiveText: { color: '#fff', fontWeight: '600' },
  column: { gap: 8, padding: 10, borderRadius: 10, backgroundColor: '#f4f4f5' },
  columnTitle: { fontSize: 15, fontWeight: '600' },
  cardWrap: { gap: 6 },
  card: { gap: 4, padding: 12, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  key: { fontSize: 12, fontWeight: '700', color: '#555' },
  taskTitle: { fontSize: 15, fontWeight: '500' },
  meta: { fontSize: 12.5, color: '#555' },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#888' },
  buttonText: { fontSize: 16 },
});
