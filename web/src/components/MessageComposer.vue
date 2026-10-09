<script setup lang="ts">
import { AtSign, Paperclip, SendHorizontal, X } from '@lucide/vue'
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { useAttachmentUploads } from '../composables/useAttachmentUploads'
import { useMentionInput } from '../composables/useMentionInput'
import { formatFileSize } from '../formatFileSize'
import { useAuthStore } from '../stores/auth'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useMessagesStore } from '../stores/messages'

const MAX_LENGTH = 4000

const props = defineProps<{
  send?: (body: string, attachmentIds: number[]) => Promise<void>
  placeholder?: string
  channelId?: number
}>()

const { t } = useI18n()
const hintId = useId()
const listId = useId()
const messages = useMessagesStore()
const directory = useMemberDirectoryStore()
const auth = useAuthStore()
const field = ref<HTMLTextAreaElement | null>(null)
const sending = ref(false)
const errorText = ref<string | null>(null)
const activeIndex = ref(0)
const picker = ref<HTMLInputElement | null>(null)
const uploads = useAttachmentUploads(() => props.channelId ?? messages.channelId ?? 0)

const mention = useMentionInput({
  members: () => directory.members,
  excludeUserId: () => auth.user?.id,
})

const open = computed(() => mention.suggestions.value.length > 0)
const tooLong = computed(() => mention.length.value > MAX_LENGTH)
const canSend = computed(
  () =>
    !sending.value &&
    !uploads.busy.value &&
    !tooLong.value &&
    (mention.serialized.value.trim() !== '' || uploads.attachmentIds.value.length > 0),
)

function optionId(index: number): string {
  return `${listId}-${index}`
}

watch(
  () => mention.query.value,
  (query) => {
    if (query) void directory.ensureLoaded()
  },
)
watch(
  () => mention.suggestions.value.map((m) => m.id).join(','),
  () => {
    activeIndex.value = 0
  },
)

async function setCaret(position: number | null): Promise<void> {
  if (position === null) return
  await nextTick()
  field.value?.focus()
  field.value?.setSelectionRange(position, position)
}

function onInput(event: Event): void {
  const el = event.target as HTMLTextAreaElement
  mention.update(el.value, el.selectionStart)
}

function syncCaret(): void {
  const el = field.value
  if (el) mention.moveCaret(el.selectionStart, el.selectionEnd)
}

function choose(index: number): void {
  const member = mention.suggestions.value[index]
  if (!member) return
  void setCaret(mention.select(member))
}

function insertTrigger(): void {
  syncCaret()
  void setCaret(mention.insertTrigger())
  void directory.ensureLoaded()
}

const uploadStatus = computed(() => {
  const items = uploads.items.value
  const uploading = items.filter((item) => item.status === 'uploading').at(-1)
  if (uploading) return t('attachments.uploadingFile', { name: uploading.name })
  const failed = items.filter((item) => item.status === 'error').at(-1)
  return failed ? t('attachments.failedFile', { name: failed.name, error: failed.error ?? '' }) : ''
})

function errorId(key: number): string {
  return `${listId}-error-${key}`
}

function pickFiles(): void {
  picker.value?.click()
}

function onPicked(event: Event): void {
  const input = event.target as HTMLInputElement
  const chosen = Array.from(input.files ?? [])
  input.value = ''
  uploads.add(chosen)
}

function onPaste(event: ClipboardEvent): void {
  const pasted = Array.from(event.clipboardData?.files ?? [])
  if (pasted.length === 0) return
  event.preventDefault()
  uploads.add(pasted)
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function onDragOver(event: DragEvent): void {
  if (hasFiles(event)) event.preventDefault()
}

function onDrop(event: DragEvent): void {
  if (!hasFiles(event)) return
  event.preventDefault()
  uploads.add(Array.from(event.dataTransfer?.files ?? []))
}

async function submit(): Promise<void> {
  if (!canSend.value) return
  sending.value = true
  errorText.value = null
  const sentText = mention.text.value
  const sentBody = mention.serialized.value
  const sentIds = [...uploads.attachmentIds.value]
  try {
    await (props.send ?? messages.send)(sentBody, sentIds)
    if (mention.text.value === sentText) mention.reset()
    for (const item of [...uploads.items.value]) {
      if (item.status === 'error' || (item.attachment && sentIds.includes(item.attachment.id))) uploads.remove(item.key)
    }
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 422) {
      errorText.value = caught.errors?.body?.[0] ?? caught.message
    } else if (caught instanceof ApiError && caught.status === 429) {
      errorText.value = t('channel.composer.rateLimited')
    } else {
      errorText.value = t('channel.composer.sendFailed')
    }
  } finally {
    sending.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (open.value) {
    const count = mention.suggestions.value.length
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      activeIndex.value = (activeIndex.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
      return
    }
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      event.preventDefault()
      choose(activeIndex.value)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      mention.dismiss()
      return
    }
  }
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  void submit()
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <div class="composer-box" @dragover="onDragOver" @drop="onDrop">
      <textarea
        ref="field"
        :value="mention.text.value"
        name="body"
        rows="2"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :aria-controls="listId"
        :aria-activedescendant="open ? optionId(activeIndex) : undefined"
        :placeholder="placeholder ?? t('channel.composer.placeholder')"
        :aria-label="placeholder ?? t('channel.composer.placeholder')"
        :aria-describedby="hintId"
        @input="onInput"
        @keydown="onKeydown"
        @keyup="syncCaret"
        @click="syncCaret"
        @blur="mention.moveCaret(null)"
        @paste="onPaste"
      />
      <ul v-if="uploads.items.value.length > 0" class="composer-files" :aria-label="t('attachments.list')">
        <li v-for="item in uploads.items.value" :key="item.key" class="composer-file" :data-status="item.status">
          <span class="composer-file-name">{{ item.name }}</span>
          <span class="composer-file-size">{{ formatFileSize(item.size) }}</span>
          <span v-if="item.status === 'uploading'" class="composer-file-state">
            {{ t('attachments.uploading') }}
          </span>
          <span v-else-if="item.status === 'error'" :id="errorId(item.key)" class="composer-file-error">
            {{ item.error }}
          </span>
          <button
            v-if="item.status === 'error' && item.retryable"
            type="button"
            name="retry-attachment"
            :aria-label="t('attachments.retryFile', { name: item.name })"
            class="composer-file-action"
            :aria-describedby="errorId(item.key)"
            @click="uploads.retry(item.key)"
          >
            {{ t('attachments.retry') }}
          </button>
          <button
            type="button"
            :name="item.status === 'uploading' ? 'cancel-attachment' : 'remove-attachment'"
            class="composer-file-action composer-file-remove"
            :aria-label="
              item.status === 'uploading'
                ? t('attachments.cancelFile', { name: item.name })
                : t('attachments.removeFile', { name: item.name })
            "
            @click="uploads.remove(item.key)"
          >
            <X :size="14" :stroke-width="2" aria-hidden="true" />
          </button>
        </li>
      </ul>
      <ul v-show="open" :id="listId" role="listbox" class="composer-suggestions" :aria-label="t('channel.composer.suggestions')">
        <li
          v-for="(member, index) in mention.suggestions.value"
          :id="optionId(index)"
          :key="member.id"
          role="option"
          class="composer-option"
          :class="{ 'composer-option--active': index === activeIndex }"
          :aria-selected="index === activeIndex"
          @mousedown.prevent
          @click="choose(index)"
        >
          <span class="composer-option-name">{{ member.name }}</span>
          <span class="composer-option-email">{{ member.email }}</span>
        </li>
      </ul>
      <span class="composer-sr" role="status">
        {{ open ? t('channel.composer.suggestionsCount', { n: mention.suggestions.value.length }) : '' }}
      </span>
      <span class="composer-sr composer-upload-status" role="status">{{ uploadStatus }}</span>
      <div class="composer-bar">
        <input ref="picker" type="file" name="attachments" multiple hidden tabindex="-1" @change="onPicked" />
        <button
          type="button"
          name="attach"
          class="composer-tool"
          :aria-label="t('attachments.attach')"
          @click="pickFiles"
        >
          <Paperclip :size="17" :stroke-width="1.8" aria-hidden="true" />
        </button>
        <button
          type="button"
          name="mention"
          class="composer-tool"
          :aria-label="t('channel.composer.mention')"
          @click="insertTrigger"
        >
          <AtSign :size="17" :stroke-width="1.8" aria-hidden="true" />
        </button>
        <span :id="hintId" class="composer-hint">{{ t('channel.composer.hint') }}</span>
        <button
          type="submit"
          name="send"
          class="composer-send"
          :disabled="!canSend"
          :aria-label="t('channel.composer.send')"
        >
          <SendHorizontal :size="16" :stroke-width="2" aria-hidden="true" />
        </button>
      </div>
    </div>
    <p v-if="tooLong" role="alert" class="composer-error">{{ t('channel.composer.tooLong', { max: MAX_LENGTH }) }}</p>
    <p v-else-if="errorText" role="alert" class="composer-error">{{ errorText }}</p>
  </form>
</template>

<style scoped>
.composer {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.composer-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 8px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
}

.composer-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);
}

.composer textarea {
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--ink);
  padding: 2px 0;
  font: inherit;
}

.composer-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.composer-hint {
  flex: 1;
  font-size: 12px;
  color: var(--ink-3);
}

.composer-send {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: var(--radius-control);
  background: var(--accent);
  color: var(--on-accent);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.composer-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.composer-send:focus-visible {
  outline: 2px solid var(--accent-ink);
  outline-offset: 2px;
}

.composer-error {
  margin: 0;
  font-size: 12px;
  color: var(--level-error-fg);
}

.composer-suggestions {
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
}

.composer-option {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 6px 8px;
  border-radius: var(--radius-control);
  color: var(--ink);
  cursor: pointer;
}

.composer-option--active {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.composer-option-email {
  font-size: 12px;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-tool {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--ink-3);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.composer-tool:hover {
  color: var(--ink);
}

.composer-tool:focus-visible {
  outline: 2px solid var(--accent-ink);
  outline-offset: 2px;
}

.composer-files {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.composer-file {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 4px 8px;
  border-radius: var(--radius-control);
  background: var(--accent-soft);
  color: var(--ink);
  font-size: 13px;
}

.composer-file[data-status='error'] {
  background: transparent;
  border: 1px solid var(--border);
}

.composer-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-file-size,
.composer-file-state {
  font-size: 12px;
  color: var(--ink-3);
  white-space: nowrap;
}

.composer-file-error {
  flex: 1;
  font-size: 12px;
  color: var(--level-error-fg);
}

.composer-file-action {
  border: 0;
  background: transparent;
  color: var(--accent-ink);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-control);
}

.composer-file-remove {
  margin-left: auto;
  display: grid;
  place-items: center;
  color: var(--ink-3);
}

.composer-file-action:focus-visible {
  outline: 2px solid var(--accent-ink);
  outline-offset: 2px;
}

.composer-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
