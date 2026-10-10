<script setup lang="ts">
import { ArrowDown, ArrowRight, ArrowUp, Ellipsis } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { isTaskStatus, TASK_STATUSES, type Task, type TaskStatus } from '../api/types'
import { useTasksStore } from '../stores/tasks'
import AppMenu, { type AppMenuItem } from './ui/AppMenu.vue'
import { toast } from './ui/toast'
import { moveErrorMessage, moveNeighbours } from './taskMove'

const props = defineProps<{ task: Task; readOnly?: boolean }>()
const { t } = useI18n()
const tasks = useTasksStore()

const statusKey: Record<TaskStatus, string> = { todo: 'todo', in_progress: 'inProgress', in_review: 'inReview', done: 'done' }
const moving = ref(false)

/** Always the full column: the API needs contiguous neighbours, so never `visibleColumns`. */
const column = computed(() => tasks.columns[props.task.status] ?? [])
const index = computed(() => column.value.findIndex((item) => item.id === props.task.id))

const items = computed<AppMenuItem[]>(() => {
  const list = column.value
  const at = index.value
  const result: AppMenuItem[] = [
    { value: 'up', label: t('plan.move.up'), icon: ArrowUp, disabled: at <= 0 },
    { value: 'down', label: t('plan.move.down'), icon: ArrowDown, disabled: at < 0 || at >= list.length - 1 },
  ]
  for (const status of TASK_STATUSES) {
    if (status === props.task.status) continue
    result.push({
      value: `to:${status}`,
      label: t('plan.move.to', { column: t(`plan.status.${statusKey[status]}`) }),
      icon: ArrowRight,
    })
  }
  return result
})

async function select(value: string): Promise<void> {
  if (moving.value || props.readOnly) return
  const list = column.value
  const at = index.value
  let input: { status: TaskStatus; afterId?: number | null; beforeId?: number | null }
  if (value === 'up' && at > 0) {
    input = { status: props.task.status, ...moveNeighbours(list, props.task.id, { beforeId: list[at - 1].id }) }
  } else if (value === 'down' && at >= 0 && at < list.length - 1) {
    input = { status: props.task.status, ...moveNeighbours(list, props.task.id, { afterId: list[at + 1].id }) }
  } else if (value.startsWith('to:') && isTaskStatus(value.slice(3))) {
    const status = value.slice(3) as TaskStatus
    input = { status, afterId: moveNeighbours(tasks.columns[status], props.task.id, null).afterId }
  } else {
    return
  }
  moving.value = true
  try {
    await tasks.move(props.task.project_id, props.task.id, input)
  } catch (caught) {
    toast.error(moveErrorMessage(caught, t))
  } finally {
    moving.value = false
  }
}
</script>

<template>
  <AppMenu v-if="!readOnly" :items="items" align="end" @select="select">
    <button type="button" class="task-move" name="move-task" :disabled="moving" :aria-label="t('plan.move.label', { key: task.key })">
      <Ellipsis :size="16" aria-hidden="true" />
    </button>
  </AppMenu>
</template>

<style scoped>
.task-move {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}
.task-move:hover,
.task-move[aria-expanded='true'] {
  background: var(--accent-soft);
  color: var(--accent-ink);
}
.task-move:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
