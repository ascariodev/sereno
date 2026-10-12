<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogGroupOpenedPayload, Message } from '../api/types'
import MessageItem from './MessageItem.vue'
import SystemNotice from './SystemNotice.vue'

const props = defineProps<{ messages: Message[]; hasMore: boolean; loadingMore: boolean; projectId?: number; ownUserId?: number; emptyLabel?: string; threadable?: boolean; canCreateTask?: boolean; focusId?: number | null }>()
defineEmits<{ loadOlder: []; select: [groupId: number]; openThread: [messageId: number]; createTask: [payload: LogGroupOpenedPayload] }>()

const { t, locale } = useI18n()

const NEAR_BOTTOM_PX = 80
const container = ref<HTMLElement | null>(null)

let pinnedToBottom = true

function scrollToBottom(): void {
  if (!container.value) return
  container.value.scrollTop = container.value.scrollHeight
  pinnedToBottom = true
}

function trackPinned(): void {
  const el = container.value
  if (el) pinnedToBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
}

function reanchorOnLateLoad(): void {
  if (pinnedToBottom) scrollToBottom()
}

const items = ref<HTMLElement | null>(null)
const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reanchorOnLateLoad)

watch(
  items,
  (next, previous) => {
    if (previous) resizeObserver?.unobserve(previous)
    if (next) resizeObserver?.observe(next)
  },
  { flush: 'post' },
)

const HIGHLIGHT_MS = 2500
const highlightedId = ref<number | null>(null)
let jumpedTo: number | null = null
let highlightTimer: ReturnType<typeof setTimeout> | undefined

function jumpToFocus(): boolean {
  const id = props.focusId ?? null
  if (id === null || id === jumpedTo) return false
  const target = container.value?.querySelector<HTMLElement>(`[data-message-id="${id}"]`)
  if (!target) return false
  jumpedTo = id
  target.scrollIntoView?.({ block: 'center' })
  trackPinned()
  highlightedId.value = id
  clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => (highlightedId.value = null), HIGHLIGHT_MS)
  return true
}

onMounted(() => {
  if (!jumpToFocus()) scrollToBottom()
})
onUnmounted(() => {
  resizeObserver?.disconnect()
  clearTimeout(highlightTimer)
})

watch(
  () => props.focusId,
  () => void nextTick(jumpToFocus),
)

watch(
  () => props.messages,
  (next, previous) => {
    const el = container.value
    if (!el || previous.length === 0 || next.length === 0) {
      void nextTick(() => {
        if (!jumpToFocus()) scrollToBottom()
      })
      return
    }
    const appended = next[next.length - 1].id !== previous[previous.length - 1].id
    const prepended = next[0].id < previous[0].id
    const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
    const heightBefore = el.scrollHeight
    const own = appended && props.ownUserId !== undefined && next[next.length - 1].user?.id === props.ownUserId
    void nextTick(() => {
      if (appended && (own || wasNearBottom)) scrollToBottom()
      else if (prepended) {
        el.scrollTop += el.scrollHeight - heightBefore
        trackPinned()
      }
    })
  },
  { flush: 'pre' },
)

type Row =
  | { key: string; type: 'day'; label: string }
  | { key: string; type: 'message'; message: Message }

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

const now = ref(new Date())
let midnightTimer: ReturnType<typeof setTimeout> | undefined

function scheduleMidnightRefresh(): void {
  const current = new Date()
  const nextMidnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1)
  midnightTimer = setTimeout(() => {
    now.value = new Date()
    scheduleMidnightRefresh()
  }, nextMidnight.getTime() - current.getTime())
}

onMounted(scheduleMidnightRefresh)
onUnmounted(() => clearTimeout(midnightTimer))

const rows = computed<Row[]>(() => {
  const today = dayKey(now.value)
  const result: Row[] = []
  let previous = ''
  for (const message of props.messages) {
    const date = new Date(message.created_at)
    const key = dayKey(date)
    if (key !== previous) {
      previous = key
      const label =
        key === today ? t('channel.today') : date.toLocaleDateString(locale.value, { dateStyle: 'long' })
      result.push({ key: `day-${key}`, type: 'day', label })
    }
    result.push({ key: `message-${message.id}`, type: 'message', message })
  }
  return result
})
</script>

<template>
  <div ref="container" class="message-list" @scroll.passive="trackPinned" @load.capture="reanchorOnLateLoad">
    <button v-if="hasMore" type="button" name="load-older" :disabled="loadingMore" @click="$emit('loadOlder')">
      {{ loadingMore ? t('common.loading') : t('channel.loadOlder') }}
    </button>
    <p v-if="messages.length === 0" class="message-list__empty">{{ emptyLabel ?? t('channel.empty') }}</p>
    <ul v-else ref="items" class="message-list__items">
      <template v-for="row in rows" :key="row.key">
        <li v-if="row.type === 'day'" class="message-list__day">{{ row.label }}</li>
        <li
          v-else
          :class="['message', `message--${row.message.kind}`, { 'message--highlight': highlightedId === row.message.id }]"
          :data-message-id="row.message.id"
        >
          <SystemNotice
            v-if="row.message.kind === 'system'"
            :message="row.message"
            :project-id="projectId"
            :threadable="threadable"
            :can-create-task="canCreateTask"
            @create-task="(payload: LogGroupOpenedPayload) => $emit('createTask', payload)"
            @select="$emit('select', $event)"
            @open-thread="$emit('openThread', $event)"
          />
          <MessageItem v-else :message="row.message" :own-user-id="ownUserId" :threadable="threadable" @open-thread="$emit('openThread', $event)" />
        </li>
      </template>
    </ul>
  </div>
</template>

<style scoped>
.message--highlight {
  background: var(--accent-soft);
  border-radius: var(--radius-panel);
  transition: background-color 0.3s;
}

.message-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-anchor: none;
}

.message-list__items {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.message-list__day {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.message-list__day::before,
.message-list__day::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}
</style>
