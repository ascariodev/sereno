<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AttachmentUrl, MessageAttachment } from '../api/types'
import { ApiError } from '../api/client'
import { getAttachmentUrl } from '../api/messages'
import { isDesktop, openExternal } from '../platform/desktop'
import { formatFileSize } from '../formatFileSize'
import { toast } from './ui/toast'

const props = defineProps<{
  attachments: MessageAttachment[]
  /** Fetches a fresh signed url when the stored one expired; defaults to the chat endpoint. */
  renewUrl?: (attachmentId: number) => Promise<AttachmentUrl>
}>()

const { t } = useI18n()

const PREVIEWABLE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
// Keyed by attachment id and remembering the store url they refer to: a new url for the same id resets them.
const retried = reactive(new Map<number, string>())
const renewed = reactive(new Map<number, { from: string; url: string }>())
const failed = reactive(new Map<number, string>())
const notice = computed(() =>
  props.attachments.some((a) => failed.get(a.id) === a.url) ? t('attachments.previewUnavailable') : '',
)

function freshUrl(id: number): Promise<AttachmentUrl> {
  return props.renewUrl ? props.renewUrl(id) : getAttachmentUrl(id)
}

function previewUrl(a: MessageAttachment): string {
  const r = renewed.get(a.id)
  return r && r.from === a.url ? r.url : a.url
}

function showsPreview(a: MessageAttachment): boolean {
  return PREVIEWABLE.includes(a.mime) && failed.get(a.id) !== a.url
}

async function onPreviewError(a: MessageAttachment) {
  if (retried.get(a.id) === a.url) {
    failed.set(a.id, a.url)
    return
  }
  retried.set(a.id, a.url)
  try {
    const { url } = await freshUrl(a.id)
    renewed.set(a.id, { from: a.url, url })
  } catch {
    failed.set(a.id, a.url)
  }
}

function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
}

function openErrorMessage(error: unknown): string {
  return error instanceof ApiError && error.status === 404 ? t('attachments.openFailed') : t('attachments.openFailedRetry')
}

async function openInSystemBrowser(url: string) {
  try {
    await openExternal(url)
  } catch {
    toast.error(t('attachments.systemBrowserFailed'))
  }
}

async function openFreshExternally(a: MessageAttachment) {
  let url: string
  try {
    url = (await freshUrl(a.id)).url
  } catch (error) {
    toast.error(openErrorMessage(error))
    return
  }
  await openInSystemBrowser(url)
}

async function openFresh(event: MouseEvent, a: MessageAttachment) {
  if (!isPlainClick(event)) return
  event.preventDefault()
  if (isDesktop()) {
    await openFreshExternally(a)
    return
  }
  const win = window.open('', '_blank')
  if (win) win.opener = null
  try {
    const { url } = await freshUrl(a.id)
    if (win) {
      win.location.href = url
      return
    }
    // With 'noopener' the standard lets window.open return null for a window that did open, so null would not prove a block.
    const fallback = window.open(url, '_blank')
    if (fallback) fallback.opener = null
    else toast.error(t('attachments.popupBlocked'))
  } catch (error) {
    win?.close()
    toast.error(openErrorMessage(error))
  }
}

async function downloadFresh(event: MouseEvent, a: MessageAttachment) {
  if (!isPlainClick(event)) return
  event.preventDefault()
  try {
    const { url } = await freshUrl(a.id)
    if (isDesktop()) await openInSystemBrowser(url)
    else window.location.assign(url)
  } catch (error) {
    toast.error(openErrorMessage(error))
  }
}
</script>

<template>
  <div v-if="attachments.length > 0" class="message-attachments-wrap">
  <span class="message-attachments__sr" role="status">{{ notice }}</span>
  <ul class="message-attachments" :aria-label="t('attachments.list')">
    <li v-for="a in attachments" :key="a.id" class="message-attachment">
      <a
        v-if="showsPreview(a)"
        class="message-attachment__thumb"
        :href="previewUrl(a)"
        target="_blank"
        rel="noopener"
        @click="openFresh($event, a)"
      >
        <img :src="previewUrl(a)" :alt="a.original_name" loading="lazy" @error="onPreviewError(a)" />
      </a>
      <template v-else>
        <p v-if="PREVIEWABLE.includes(a.mime)" class="message-attachment__note">
          {{ t('attachments.previewUnavailable') }}
        </p>
        <div class="message-attachment__file">
          <span class="message-attachment__name">{{ a.original_name }}</span>
          <span class="message-attachment__size">{{ formatFileSize(a.size) }}</span>
          <a
            class="message-attachment__download"
            :href="previewUrl(a)"
            rel="noopener"
            @click="downloadFresh($event, a)"
            :aria-label="`${t('attachments.download')}: ${a.original_name}`"
          >{{ t('attachments.download') }}</a>
        </div>
      </template>
    </li>
  </ul>
  </div>
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

.message-attachments__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
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
