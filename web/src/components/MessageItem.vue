<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message } from '../api/types'
import AppAvatar from './ui/AppAvatar.vue'
import AppTooltip from './ui/AppTooltip.vue'
import MessageAttachments from './MessageAttachments.vue'
import MessageBody from './MessageBody.vue'
import ThreadSummary from './ThreadSummary.vue'

const props = defineProps<{ message: Message; threadable?: boolean; ownUserId?: number }>()
const emit = defineEmits<{ openThread: [messageId: number] }>()

const { t, locale } = useI18n()

const author = computed(() => props.message.user?.name ?? t('channel.unknownUser'))
const date = computed(() => new Date(props.message.created_at))
const shortTime = computed(() => date.value.toLocaleTimeString(locale.value, { timeStyle: 'short' }))
const fullDate = computed(() => date.value.toLocaleString(locale.value, { dateStyle: 'full', timeStyle: 'medium' }))
const deleted = computed(() => props.message.deleted_at !== null)
const editedDate = computed(() =>
  props.message.edited_at === null
    ? ''
    : new Date(props.message.edited_at).toLocaleString(locale.value, { dateStyle: 'full', timeStyle: 'medium' }),
)
</script>

<template>
  <article class="message-item">
    <AppAvatar :name="author" :id="message.user?.id ?? 0" :size="34" />
    <div class="message-item__main">
      <p class="message-item__meta">
        <strong>{{ author }}</strong>
        <AppTooltip :text="fullDate">
          <time :datetime="message.created_at">
            <span aria-hidden="true">{{ shortTime }}</span>
            <span class="sr-only">{{ fullDate }}</span>
          </time>
        </AppTooltip>
        <AppTooltip v-if="!deleted && message.edited_at" :text="t('message.editedAt', { date: editedDate })">
          <span class="message-item__edited" data-test="edited"><span aria-hidden="true">{{ t('message.edited') }}</span><span class="sr-only">{{ t('message.editedAt', { date: editedDate }) }}</span></span>
        </AppTooltip>
      </p>
      <p v-if="deleted" class="message-item__deleted" data-test="deleted">{{ t('message.deleted') }}</p>
      <template v-else>
        <p v-if="message.body" class="message-item__body"><MessageBody :body="message.body" :mentions="message.mentions" :own-user-id="ownUserId" /></p>
        <MessageAttachments :attachments="message.attachments" />
      </template>
      <ThreadSummary v-if="threadable && message.parent_id === null" :message="message" @open="emit('openThread', $event)" />
    </div>
  </article>
</template>

<style scoped>
.message-item {
  display: flex;
  gap: 12px;
}

.message-item__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.message-item__meta,
.message-item__body {
  margin: 0;
}

.message-item__meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.message-item__meta strong {
  font-weight: 600;
}

.message-item__meta time {
  position: relative;
  font-size: 12px;
  color: var(--ink-3);
}

.message-item__edited {
  font-size: 12px;
  color: var(--ink-3);
}

.message-item__deleted {
  margin: 2px 0 0;
  color: var(--ink-3);
  font-style: italic;
}

.message-item__body {
  margin-top: 2px;
  color: var(--ink-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
