<script setup lang="ts">
import { MessageSquareReply } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message } from '../api/types'
import { useSharedNow } from '../composables/useSharedNow'
import AppAvatar from './ui/AppAvatar.vue'

const props = defineProps<{ message: Message }>()
const now = useSharedNow()
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
  const seconds = Math.round((new Date(props.message.last_reply_at).getTime() - now.value) / 1000)
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
      <span v-if="message.recent_participants.length > 0" class="thread-summary__avatars" data-test="participants">
        <AppAvatar
          v-for="user in message.recent_participants"
          :key="user.id"
          :name="user.name"
          :id="user.id"
          :size="20"
          class="thread-summary__avatar"
        />
      </span>
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
.thread-summary__avatars {
  display: inline-flex;
}
.thread-summary__avatar {
  border: 2px solid var(--surface);
  box-sizing: content-box;
}
.thread-summary__avatar + .thread-summary__avatar {
  margin-left: -6px;
}
.thread-summary__when {
  font-weight: 400;
  color: var(--ink-3);
}
</style>
