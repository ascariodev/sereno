<script setup lang="ts">
import { Paperclip, X } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import type { TaskComment } from '../api/types'
import { getTaskAttachmentUrl, taskAttachmentsPath } from '../api/taskComments'
import { useAttachmentUploads } from '../composables/useAttachmentUploads'
import { useSharedNow } from '../composables/useSharedNow'
import { formatFileSize } from '../formatFileSize'
import { useAuthStore } from '../stores/auth'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useTaskCommentsStore } from '../stores/taskComments'
import MarkdownContent from './MarkdownContent.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import MessageAttachments from './MessageAttachments.vue'
import TaskCommentEditor from './TaskCommentEditor.vue'
import { charCount, TASK_DESCRIPTION_MAX_LENGTH } from './taskLimits'
import AppAvatar from './ui/AppAvatar.vue'
import AppFormError from './ui/AppFormError.vue'
import AppTooltip from './ui/AppTooltip.vue'

const props = defineProps<{ projectId: number; taskId: number }>()

const { t, locale } = useI18n()
const store = useTaskCommentsStore()
const auth = useAuthStore()
const directory = useMemberDirectoryStore()
const now = useSharedNow()

const draft = ref('')
const sending = ref(false)
const formError = ref<string | null>(null)
const picker = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
const fileIdPrefix = useId()
const headingId = `${fileIdPrefix}-heading`
const sentNotice = ref('')
const editingId = ref<number | null>(null)
// Keyed by the upload path: changing task drops the items and discards uploads still in flight (L-10).
const uploads = useAttachmentUploads(() => taskAttachmentsPath(props.projectId, props.taskId), {
  tooManyKey: 'taskComments.tooManyAttachments',
})
let sendToken = 0

watch(
  () => `${props.projectId}:${props.taskId}`,
  () => {
    sendToken++
    draft.value = ''
    sending.value = false
    formError.value = null
    sentNotice.value = ''
    editingId.value = null
    void store.open(props.projectId, props.taskId)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  sendToken++
  store.clear()
})

const mentionOptions = computed(() => ({
  members: directory.membersOf(props.projectId),
  excludeUserId: auth.user?.id,
  ensureLoaded: () => directory.ensureLoaded(props.projectId),
}))

const empty = computed(() => !store.loading && store.error === null && store.comments.length === 0)
const canSend = computed(
  () =>
    !sending.value &&
    !uploads.busy.value &&
    draft.value.trim() !== '' &&
    charCount(draft.value) <= TASK_DESCRIPTION_MAX_LENGTH,
)

const uploadStatus = computed(() => {
  const items = uploads.items.value
  const uploading = items.filter((item) => item.status === 'uploading').at(-1)
  if (uploading) return t('attachments.uploadingFile', { name: uploading.name })
  const failed = items.filter((item) => item.status === 'error').at(-1)
  return failed ? t('attachments.failedFile', { name: failed.name, error: failed.error ?? '' }) : ''
})

function fileErrorId(key: number): string {
  return `${fileIdPrefix}-file-error-${key}`
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

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

function when(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now.value) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.trunc(seconds / size), unit)
  }
  return formatter.format(0, 'second')
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(locale.value, { dateStyle: 'full', timeStyle: 'medium' })
}

async function finishEditing(commentId: number): Promise<void> {
  editingId.value = null
  await nextTick()
  list.value?.querySelector<HTMLButtonElement>(`[data-comment-id="${commentId}"] [data-test="comment-edit"]`)?.focus()
}

function isOwn(comment: TaskComment): boolean {
  return comment.user !== null && comment.user.id === auth.user?.id
}

function retry(): void {
  if (store.comments.length === 0) void store.open(props.projectId, props.taskId)
  else void store.loadOlder()
}

async function submit(): Promise<void> {
  if (!canSend.value) return
  const token = ++sendToken
  formError.value = null
  sentNotice.value = ''
  sending.value = true
  const sentIds = [...uploads.attachmentIds.value]
  try {
    const sentId = await store.send(draft.value.trim(), sentIds)
    if (token !== sendToken) return
    draft.value = ''
    sentNotice.value = t('taskComments.sent')
    for (const item of [...uploads.items.value]) {
      if (item.status === 'error' || (item.attachment && sentIds.includes(item.attachment.id))) uploads.remove(item.key)
    }
    if (sentId !== null) {
      await nextTick()
      if (token === sendToken) list.value?.querySelector(`[data-comment-id="${sentId}"]`)?.scrollIntoView({ block: 'nearest' })
    }
  } catch (error) {
    if (token !== sendToken) return
    if (!(error instanceof ApiError)) throw error
    if (error.status === 422) formError.value = error.message
    else if (error.status === 429) formError.value = t('taskComments.tooManyAttempts')
    else if (error.status === 0) formError.value = t('taskComments.network')
    else formError.value = t('taskComments.sendFailed')
  } finally {
    if (token === sendToken) sending.value = false
  }
}
</script>

<template>
  <section class="task-comments" :aria-labelledby="headingId" data-test="task-comments">
    <h2 :id="headingId" class="task-comments__heading">{{ t('taskComments.heading') }}</h2>

    <p v-if="store.loading" role="status" class="task-comments__note" data-test="comments-loading">{{ t('common.loading') }}</p>

    <div v-else-if="store.error" class="task-comments__error" data-test="comments-error">
      <AppFormError>{{ t('taskComments.loadFailed') }}</AppFormError>
      <button type="button" class="task-comments__button" data-test="comments-retry" @click="retry">{{ t('common.retry') }}</button>
    </div>

    <p v-if="empty" role="status" class="task-comments__note" data-test="comments-empty">{{ t('taskComments.empty') }}</p>

    <button
      v-if="store.nextCursor !== null && !store.loading"
      type="button"
      class="task-comments__button"
      data-test="load-older"
      :disabled="store.loadingMore"
      @click="store.loadOlder()"
    >
      {{ store.loadingMore ? t('common.loading') : t('taskComments.loadOlder') }}
    </button>

    <ul v-if="store.comments.length > 0" ref="list" class="task-comments__list" :aria-labelledby="headingId">
      <li v-for="comment in store.comments" :key="comment.id" class="task-comments__item" data-test="comment" :data-comment-id="comment.id">
        <AppAvatar v-if="comment.user" :name="comment.user.name" :id="comment.user.id" :size="28" />
        <div class="task-comments__main">
          <p class="task-comments__meta">
            <span class="task-comments__author" data-test="comment-author">{{ comment.user?.name ?? t('taskComments.deletedUser') }}</span>
            <time :datetime="comment.created_at" :title="fullDate(comment.created_at)">{{ when(comment.created_at) }}</time>
            <AppTooltip v-if="comment.edited_at" :text="t('message.editedAt', { date: fullDate(comment.edited_at) })">
              <span class="task-comments__edited" data-test="comment-edited"><span aria-hidden="true">{{ t('message.edited') }}</span><span class="task-comments__sr">{{ t('message.editedAt', { date: fullDate(comment.edited_at) }) }}</span></span>
            </AppTooltip>
            <button
              v-if="isOwn(comment) && editingId !== comment.id"
              type="button"
              class="task-comments__edit"
              data-test="comment-edit"
              :aria-label="t('taskComments.editNamed', { name: comment.user?.name ?? '' })"
              @click="editingId = comment.id"
            >
              {{ t('taskComments.edit') }}
            </button>
          </p>
          <TaskCommentEditor
            v-if="editingId === comment.id"
            :project-id="projectId"
            :task-id="taskId"
            :comment="comment"
            :mentions="mentionOptions"
            @done="finishEditing(comment.id)"
          />
          <template v-else>
            <MarkdownContent :source="comment.body" :mentions="comment.mentions" :own-user-id="auth.user?.id" />
            <MessageAttachments :attachments="comment.attachments" :renew-url="getTaskAttachmentUrl" />
          </template>
        </div>
      </li>
    </ul>

    <form class="task-comments__form" novalidate @submit.prevent="submit">
      <label class="task-comments__label" for="task-comment-body">{{ t('taskComments.newLabel') }}</label>
      <div class="task-comments__drop" data-test="comment-drop" @paste="onPaste" @dragover="onDragOver" @drop="onDrop">
        <MarkdownEditor
          id="task-comment-body"
          v-model="draft"
          name="comment"
          :rows="3"
          :max-length="TASK_DESCRIPTION_MAX_LENGTH"
          :readonly="sending"
          :mentions="mentionOptions"
        />
      </div>
      <ul v-if="uploads.items.value.length > 0" class="task-comments__files" :aria-label="t('attachments.list')">
        <li
          v-for="item in uploads.items.value"
          :key="item.key"
          class="task-comments__file"
          :data-status="item.status"
          data-test="comment-file"
        >
          <span class="task-comments__file-name">{{ item.name }}</span>
          <span class="task-comments__file-size">{{ formatFileSize(item.size) }}</span>
          <span v-if="item.status === 'uploading'" class="task-comments__file-state">{{ t('attachments.uploading') }}</span>
          <span
            v-else-if="item.status === 'error'"
            :id="fileErrorId(item.key)"
            class="task-comments__file-error"
            data-test="comment-file-error"
          >{{ item.error }}</span>
          <button
            v-if="item.status === 'error' && item.retryable"
            type="button"
            class="task-comments__file-action"
            data-test="comment-file-retry"
            :aria-label="t('attachments.retryFile', { name: item.name })"
            :aria-describedby="fileErrorId(item.key)"
            @click="uploads.retry(item.key)"
          >
            {{ t('attachments.retry') }}
          </button>
          <button
            type="button"
            class="task-comments__file-action task-comments__file-remove"
            data-test="comment-file-remove"
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
      <span class="task-comments__sr" role="status" data-test="comment-upload-status">{{ uploadStatus }}</span>
      <span class="task-comments__sr" role="status" data-test="comment-sent-status">{{ sentNotice }}</span>
      <AppFormError v-if="formError" data-test="comment-error">{{ formError }}</AppFormError>
      <div class="task-comments__actions">
        <input
          ref="picker"
          type="file"
          name="attachments"
          multiple
          hidden
          tabindex="-1"
          data-test="comment-picker"
          @change="onPicked"
        />
        <button
          type="button"
          class="task-comments__attach"
          data-test="comment-attach"
          :aria-label="t('attachments.attach')"
          @click="pickFiles"
        >
          <Paperclip :size="17" :stroke-width="1.8" aria-hidden="true" />
        </button>
        <button type="submit" class="task-comments__send" data-test="comment-send" :disabled="!canSend">
          {{ sending ? t('taskComments.sending') : t('taskComments.send') }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.task-comments {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.task-comments__heading {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.task-comments__note {
  margin: 0;
  font-size: 13px;
  color: var(--ink-3);
}
.task-comments__error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.task-comments__list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.task-comments__item {
  display: flex;
  gap: 10px;
  min-width: 0;
}
.task-comments__main {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.task-comments__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 2px;
  font-size: 12px;
  color: var(--ink-3);
}
.task-comments__author {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.task-comments__edited {
  font-size: 12px;
  color: var(--ink-3);
}
.task-comments__edit {
  margin-left: auto;
  padding: 2px 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--accent-ink);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.task-comments__form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.task-comments__label {
  font-size: 13px;
  font-weight: 600;
}
.task-comments__button {
  align-self: flex-start;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}
.task-comments__button:disabled {
  opacity: 0.6;
  cursor: default;
}
.task-comments__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.task-comments__attach {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
}
.task-comments__files {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.task-comments__file {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: flex-start;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--ink);
  font-size: 13px;
}
.task-comments__file[data-status='error'] {
  background: transparent;
  border: 1px solid var(--border);
}
.task-comments__file-name {
  min-width: 0;
  overflow-wrap: anywhere;
}
.task-comments__file-size,
.task-comments__file-state {
  font-size: 12px;
  color: var(--ink-3);
  white-space: nowrap;
}
.task-comments__file-error {
  flex: 1;
  font-size: 12px;
  color: var(--level-error-fg);
}
.task-comments__file-action {
  padding: 2px 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--accent-ink);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.task-comments__file-remove {
  display: grid;
  place-items: center;
  min-width: 32px;
  min-height: 32px;
  margin-left: auto;
  color: var(--ink-3);
}
.task-comments__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.task-comments__send {
  min-height: 44px;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  background: var(--ink);
  color: var(--surface);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.task-comments__send:disabled {
  opacity: 0.6;
  cursor: default;
}
.task-comments__button:focus-visible,
.task-comments__edit:focus-visible,
.task-comments__attach:focus-visible,
.task-comments__file-action:focus-visible,
.task-comments__send:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
