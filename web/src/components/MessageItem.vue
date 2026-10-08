<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message } from '../api/types'
import AppAvatar from './ui/AppAvatar.vue'
import AppTooltip from './ui/AppTooltip.vue'

const props = defineProps<{ message: Message }>()

const { t, locale } = useI18n()

const author = computed(() => props.message.user?.name ?? t('channel.unknownUser'))
const date = computed(() => new Date(props.message.created_at))
const shortTime = computed(() => date.value.toLocaleTimeString(locale.value, { timeStyle: 'short' }))
const fullDate = computed(() => date.value.toLocaleString(locale.value, { dateStyle: 'full', timeStyle: 'medium' }))
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
            <span class="message-item__full-date">{{ fullDate }}</span>
          </time>
        </AppTooltip>
      </p>
      <p class="message-item__body">{{ message.body }}</p>
    </div>
  </article>
</template>

<style scoped>
.message-item {
  display: flex;
  gap: 12px;
}

.message-item__main {
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

.message-item__full-date {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.message-item__body {
  margin-top: 2px;
  color: var(--ink-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
