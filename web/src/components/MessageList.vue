<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message } from '../api/types'
import MessageItem from './MessageItem.vue'
import SystemNotice from './SystemNotice.vue'

const props = defineProps<{ messages: Message[]; hasMore: boolean; loadingMore: boolean; projectId?: number; ownUserId?: number }>()
defineEmits<{ loadOlder: []; select: [groupId: number] }>()

const { t, locale } = useI18n()

const NEAR_BOTTOM_PX = 80
const container = ref<HTMLElement | null>(null)

function scrollToBottom(): void {
  if (container.value) container.value.scrollTop = container.value.scrollHeight
}

onMounted(scrollToBottom)

watch(
  () => props.messages,
  (next, previous) => {
    const el = container.value
    if (!el || previous.length === 0 || next.length === 0) {
      void nextTick(scrollToBottom)
      return
    }
    const appended = next[next.length - 1].id !== previous[previous.length - 1].id
    const prepended = next[0].id < previous[0].id
    const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
    const heightBefore = el.scrollHeight
    const own = appended && props.ownUserId !== undefined && next[next.length - 1].user?.id === props.ownUserId
    void nextTick(() => {
      if (appended && (own || wasNearBottom)) scrollToBottom()
      else if (prepended) el.scrollTop += el.scrollHeight - heightBefore
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

const rows = computed<Row[]>(() => {
  const today = dayKey(new Date())
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
  <div ref="container" class="message-list">
    <button v-if="hasMore" type="button" name="load-older" :disabled="loadingMore" @click="$emit('loadOlder')">
      {{ loadingMore ? t('common.loading') : t('channel.loadOlder') }}
    </button>
    <p v-if="messages.length === 0" class="message-list__empty">{{ t('channel.empty') }}</p>
    <ul v-else class="message-list__items">
      <template v-for="row in rows" :key="row.key">
        <li v-if="row.type === 'day'" class="message-list__day">{{ row.label }}</li>
        <li v-else :class="['message', `message--${row.message.kind}`]">
          <SystemNotice
            v-if="row.message.kind === 'system'"
            :message="row.message"
            :project-id="projectId"
            @select="$emit('select', $event)"
          />
          <MessageItem v-else :message="row.message" />
        </li>
      </template>
    </ul>
  </div>
</template>

<style scoped>
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
