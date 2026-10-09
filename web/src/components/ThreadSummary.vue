<script setup lang="ts">
import { MessageSquareReply } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message } from '../api/types'

const props = defineProps<{ message: Message }>()
const emit = defineEmits<{ open: [messageId: number] }>()

const { t, locale } = useI18n()

const count = computed(() => props.message.replies_count)

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

const when = computed(() => {
  if (!props.message.last_reply_at) return null
  const seconds = Math.round((new Date(props.message.last_reply_at).getTime() - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.trunc(seconds / size), unit)
  }
  return formatter.format(0, 'second')
})
</script>

<template>
  <button type="button" class="thread-summary" name="open-thread" @click="emit('open', message.id)">
    <MessageSquareReply :size="15" :stroke-width="1.8" aria-hidden="true" />
    <template v-if="count > 0">
      <span class="thread-summary__count">{{ t('thread.replies', { n: count }, count) }}</span>
      <span v-if="when" class="thread-summary__when">{{ t('thread.lastReply', { when }) }}</span>
    </template>
    <span v-else>{{ t('thread.replyAction') }}</span>
  </button>
</template>

<style scoped>
.thread-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  min-height: 28px;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-2);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}
.thread-summary:hover {
  background: var(--border);
  color: var(--ink);
}
.thread-summary__when {
  font-weight: 400;
  color: var(--ink-3);
}
</style>
