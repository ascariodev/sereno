<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LogGroupPanel from './LogGroupPanel.vue'
import AppDialog from './ui/AppDialog.vue'

defineOptions({ inheritAttrs: false })
defineProps<{ projectId: number; groupId: number; refreshToken?: number }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

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

onMounted(() => {
  if (!narrow.value) focusPanel()
})
watch(narrow, (isNarrow) => {
  if (!isNarrow) focusPanel()
})

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
      :refresh-token="refreshToken"
      @close="emit('close')"
    />
  </AppDialog>
  <LogGroupPanel
    v-else
    ref="panel"
    v-bind="$attrs"
    :project-id="projectId"
    :group-id="groupId"
    :refresh-token="refreshToken"
    @close="emit('close')"
  />
</template>

<style scoped>
.log-group-aside__sheet-panel.log-group-aside__sheet-panel {
  padding: 0;
  border-left: 0;
  background: transparent;
}
</style>
