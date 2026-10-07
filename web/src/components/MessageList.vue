<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Message } from '../api/types'
import SystemNotice from './SystemNotice.vue'

defineProps<{ messages: Message[]; hasMore: boolean; loadingMore: boolean }>()
defineEmits<{ loadOlder: [] }>()

const { t, locale } = useI18n()

function time(value: string): string {
  return new Date(value).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' })
}
</script>

<template>
  <div class="message-list">
    <button v-if="hasMore" type="button" name="load-older" :disabled="loadingMore" @click="$emit('loadOlder')">
      {{ loadingMore ? t('organization.loading') : t('channel.loadOlder') }}
    </button>
    <p v-if="messages.length === 0" class="message-list__empty">{{ t('channel.empty') }}</p>
    <ul v-else class="message-list__items">
      <li v-for="message in messages" :key="message.id" :class="['message', `message--${message.kind}`]">
        <SystemNotice v-if="message.kind === 'system'" :message="message" />
        <template v-else>
          <p class="message__meta">
            <strong>{{ message.user?.name }}</strong>
            <time :datetime="message.created_at">{{ time(message.created_at) }}</time>
          </p>
          <p class="message__body">{{ message.body }}</p>
        </template>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.message-list__items {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.message__meta,
.message__body {
  margin: 0;
}

.message__meta time {
  margin-left: 0.5rem;
  opacity: 0.6;
  font-size: 0.85em;
}

.message__body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
