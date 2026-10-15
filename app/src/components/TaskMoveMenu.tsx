import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import {
  isTaskStatus,
  movingTaskIds,
  moveNeighbours,
  type MoveTaskInput,
  TASK_STATUSES,
  type Task,
  type TaskColumns,
  type TaskStatus,
  useTasksStore,
} from '@/tasks/store';

function moveErrorKey(caught: unknown): string {
  const status = caught instanceof ApiError ? caught.status : 0;
  if (status === 403) return 'tasks.move.forbidden';
  if (status === 404) return 'tasks.move.notFound';
  if (status === 0) return 'taskCreate.network';
  return 'tasks.move.failed';
}

interface Props {
  task: Task;
  /** The full column of every status: the API needs contiguous neighbours, so never the filtered view. */
  columns: TaskColumns;
}

export function TaskMoveMenu({ task, columns }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const column = columns[task.status];
  const at = column.findIndex((item) => item.id === task.id);

  async function select(value: string) {
    if (movingTaskIds.has(task.id)) return;
    let input: MoveTaskInput;
    if (value === 'up' && at > 0) {
      input = { status: task.status, ...moveNeighbours(column, task.id, { beforeId: column[at - 1].id }) };
    } else if (value === 'down' && at >= 0 && at < column.length - 1) {
      input = { status: task.status, ...moveNeighbours(column, task.id, { afterId: column[at + 1].id }) };
    } else if (value.startsWith('to:') && isTaskStatus(value.slice(3))) {
      const status = value.slice(3) as TaskStatus;
      input = { status, afterId: moveNeighbours(columns[status], task.id, null).afterId };
    } else {
      return;
    }
    movingTaskIds.add(task.id);
    setMoving(true);
    setOpen(false);
    try {
      await useTasksStore.getState().move(task.project_id, task.id, input);
    } catch (caught) {
      Alert.alert(t(moveErrorKey(caught)));
    } finally {
      movingTaskIds.delete(task.id);
      if (mounted.current) setMoving(false);
    }
  }

  const options = [
    { value: 'up', label: t('tasks.move.up'), disabled: at <= 0 },
    { value: 'down', label: t('tasks.move.down'), disabled: at < 0 || at >= column.length - 1 },
    ...TASK_STATUSES.filter((status) => status !== task.status).map((status) => ({
      value: `to:${status}`,
      label: t('tasks.move.to', { column: t(`tasks.status.${status}`) }),
      disabled: false,
    })),
  ];

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tasks.move.label', { key: task.key })}
        accessibilityState={{ expanded: open, disabled: moving }}
        disabled={moving}
        onPress={() => setOpen((value) => !value)}
        style={styles.trigger}
      >
        <Text>{t('tasks.move.menu')}</Text>
      </Pressable>
      {open
        ? options.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ disabled: option.disabled }}
              disabled={option.disabled}
              onPress={() => void select(option.value)}
              style={[styles.option, option.disabled && styles.disabled]}
            >
              <Text>{option.label}</Text>
            </Pressable>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#888' },
  option: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderBottomWidth: 1, borderColor: '#ddd' },
  disabled: { opacity: 0.4 },
});
