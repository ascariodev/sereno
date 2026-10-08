<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogGroupStatus } from '../api/types'
import { useLogGroup } from '../composables/useLogGroup'
import { setGroupStatus, statusOfGroup } from '../composables/useLogGroupStatuses'
import LogGroupPanel from './LogGroupPanel.vue'
import AppDialog from './ui/AppDialog.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ projectId: number; groupId: number; refreshToken?: number }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const { group, loading, loadError, setStatus } = useLogGroup(
  () => props.projectId,
  () => props.groupId,
  () => props.refreshToken,
)

watch(
  () => statusOfGroup(props.groupId),
  (status) => {
    if (status) setStatus(status)
  },
)

function applyStatus(status: LogGroupStatus): void {
  setGroupStatus(props.groupId, status)
  setStatus(status)
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
      class="log-group-aside__sheet-panel"
      :project-id="projectId"
      :group-id="groupId"
      :group="group"
      :loading="loading"
      :load-error="loadError"
      @status="applyStatus"
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
    @status="applyStatus"
    @close="emit('close')"
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
