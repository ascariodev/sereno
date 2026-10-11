<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getLogGroup } from '../api/logGroups'
import type { LogGroupStatus, Task } from '../api/types'
import { useLogGroup } from '../composables/useLogGroup'
import { setGroupStatus, setGroupTask, statusOfGroup, taskOfGroup } from '../composables/useLogGroupStatuses'
import { useProjectsStore } from '../stores/projects'
import LogGroupPanel from './LogGroupPanel.vue'
import { TASK_TITLE_MAX_LENGTH } from './taskLimits'
import TaskCreateDialog from './TaskCreateDialog.vue'
import { toast } from './ui/toast'
import AppDialog from './ui/AppDialog.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ projectId: number; groupId: number; refreshToken?: number }>()
const emit = defineEmits<{ close: [replace?: boolean]; status: [status: LogGroupStatus] }>()

const { t } = useI18n()
const { group, loading, loadError, hourly, setStatus, setTask } = useLogGroup(
  () => props.projectId,
  () => props.groupId,
  () => props.refreshToken,
)

const projects = useProjectsStore()
const canCreateTask = computed(() => {
  const project = projects.projects.find((item) => item.id === props.projectId)
  return project !== undefined && project.archived_at === null
})

let closed = false

const createOpen = ref(false)

watch(
  () => props.groupId,
  () => {
    closed = false
    createOpen.value = false
  },
)

watch(loadError, (error) => {
  if (error !== 'notFound' || closed) return
  closed = true
  toast.error(t('logGroup.notFound'))
  emit('close', true)
})

watch(
  () => statusOfGroup(props.groupId),
  (status) => {
    if (status) setStatus(status)
  },
)

const initialTitle = computed(() => [...(group.value?.title ?? '')].slice(0, TASK_TITLE_MAX_LENGTH).join(''))
const showCreateDialog = computed(() => canCreateTask.value && group.value !== null && !(group.value.task ?? taskOfGroup(props.groupId)))

function focusTaskLink(): void {
  void nextTick(() => panel.value?.$el.querySelector<HTMLElement>('[data-test="group-task-link"]')?.focus())
}

function onTaskCreated(task: Task): void {
  setGroupTask(props.groupId, { id: task.id, key: task.key, status: task.status })
  setTask(task)
  focusTaskLink()
}

async function onGroupTaken(): Promise<void> {
  const target = props.groupId
  try {
    const loaded = await getLogGroup(props.projectId, target)
    if (!loaded.task) throw new Error('no task')
    setGroupTask(target, loaded.task)
    if (target === props.groupId) focusTaskLink()
    toast.info(t('notice.actions.taskExists', { key: loaded.task.key }))
  } catch {
    toast.error(t('notice.actions.taskExistsFailed'))
  }
}

function applyStatus(status: LogGroupStatus): void {
  setGroupStatus(props.groupId, status)
  setStatus(status)
  emit('status', status)
}

const narrowQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 767px)') : null
const narrow = ref(narrowQuery?.matches ?? false)

function followViewport(event: MediaQueryListEvent): void {
  narrow.value = event.matches
}

narrowQuery?.addEventListener('change', followViewport)

const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
const panel = ref<{ $el: HTMLElement } | null>(null)

function focusPanel(): void {
  void nextTick(() => panel.value?.$el.focus({ preventScroll: true }))
}

function isEditingField(element: Element | null): boolean {
  return element instanceof HTMLElement && (element.isContentEditable || element.matches('input, textarea, select, [role="textbox"]'))
}

onMounted(() => {
  if (!narrow.value && !isEditingField(document.activeElement)) focusPanel()
})
watch(
  narrow,
  (isNarrow) => {
    const focusWasInPanel = document.activeElement?.closest('.log-group-panel') != null
    if (!isNarrow && focusWasInPanel) focusPanel()
  },
  { flush: 'pre' },
)

onBeforeUnmount(() => {
  narrowQuery?.removeEventListener('change', followViewport)
  if (!narrow.value && opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true })
})

function onOpenChange(open: boolean): void {
  if (!open) emit('close')
}
</script>

<template>
  <AppDialog v-if="narrow" :open="true" variant="sheet-bottom" :title="t('logGroup.label')" hide-title @update:open="onOpenChange">
    <LogGroupPanel
      ref="panel"
      class="log-group-aside__sheet-panel"
      :project-id="projectId"
      :group-id="groupId"
      :group="group"
      :loading="loading"
      :load-error="loadError"
      :hourly="hourly"
      :can-create-task="canCreateTask"
      @status="applyStatus"
      @create-task="createOpen = true"
      @close="emit('close')"
    />
  </AppDialog>
  <LogGroupPanel
    v-else
    ref="panel"
    v-bind="$attrs"
    :project-id="projectId"
    :group-id="groupId"
    :group="group"
    :loading="loading"
    :load-error="loadError"
    :hourly="hourly"
    :can-create-task="canCreateTask"
    @status="applyStatus"
    @create-task="createOpen = true"
    @close="emit('close')"
  />
  <TaskCreateDialog
    v-if="showCreateDialog"
    v-model:open="createOpen"
    :project-id="projectId"
    :initial-title="initialTitle"
    :log-group-id="groupId"
    @created="onTaskCreated"
    @group-taken="onGroupTaken"
  />
</template>

<style scoped>
/* Repeating the class raises specificity above LogGroupPanel's own scoped `.log-group-panel` rule, whose order relative to this one is not guaranteed. */
.log-group-aside__sheet-panel.log-group-aside__sheet-panel {
  padding: 0;
  border-left: 0;
  background: transparent;
}
</style>
