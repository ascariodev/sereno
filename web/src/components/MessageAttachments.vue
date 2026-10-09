<script setup lang="ts">
import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MessageAttachment } from '../api/types'
import { formatFileSize } from '../formatFileSize'

defineProps<{ attachments: MessageAttachment[] }>()

const { t } = useI18n()

const PREVIEWABLE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const failed = reactive(new Set<string>())

function showsPreview(a: MessageAttachment): boolean {
  return PREVIEWABLE.includes(a.mime) && !failed.has(a.url)
}
</script>

<template>
  <ul v-if="attachments.length > 0" class="message-attachments" :aria-label="t('attachments.list')">
    <li v-for="a in attachments" :key="a.id" class="message-attachment">
      <a v-if="showsPreview(a)" class="message-attachment__thumb" :href="a.url" target="_blank" rel="noopener">
        <img :src="a.url" :alt="a.original_name" loading="lazy" @error="failed.add(a.url)" />
      </a>
      <template v-else>
        <p v-if="PREVIEWABLE.includes(a.mime)" class="message-attachment__note" role="status">
          {{ t('attachments.previewUnavailable') }}
        </p>
        <div class="message-attachment__file">
          <span class="message-attachment__name">{{ a.original_name }}</span>
          <span class="message-attachment__size">{{ formatFileSize(a.size) }}</span>
          <a
            class="message-attachment__download"
            :href="a.url"
            rel="noopener"
            :aria-label="`${t('attachments.download')}: ${a.original_name}`"
          >{{ t('attachments.download') }}</a>
        </div>
      </template>
    </li>
  </ul>
</template>

<style scoped>
.message-attachments {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  min-width: 0;
  max-width: 100%;
}

.message-attachment {
  max-width: 100%;
}

.message-attachment__thumb {
  display: block;
  width: 240px;
  max-width: 100%;
  aspect-ratio: 3 / 2;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.message-attachment__thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.message-attachment__note {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--ink-3);
}

.message-attachment__file {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  max-width: 100%;
}

.message-attachment__name {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--ink);
}

.message-attachment__size {
  flex: none;
  font-size: 12px;
  color: var(--ink-3);
}

.message-attachment__download {
  flex: none;
  font-size: 13px;
  color: var(--accent-ink);
}

.message-attachment__thumb:focus-visible,
.message-attachment__download:focus-visible {
  outline: 2px solid var(--accent-ink);
  outline-offset: 2px;
}
</style>
