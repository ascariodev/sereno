<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { updateTaskComment } from '../api/taskComments'
import type { TaskComment } from '../api/types'
import { useTaskCommentsStore } from '../stores/taskComments'
import MarkdownEditor, { type MarkdownMentionOptions } from './MarkdownEditor.vue'
import { charCount, TASK_DESCRIPTION_MAX_LENGTH } from './taskLimits'
import AppFormError from './ui/AppFormError.vue'

const props = defineProps<{ projectId: number; taskId: number; comment: TaskComment; mentions: MarkdownMentionOptions }>()
const emit = defineEmits<{ done: [] }>()

const { t } = useI18n()
const store = useTaskCommentsStore()
const fieldId = useId()
const draft = ref(props.comment.body)
const removedIds = ref<number[]>([])
const saving = ref(false)
const errorText = ref<string | null>(null)
const form = ref<HTMLFormElement | null>(null)
let alive = true

onMounted(() => {
  const field = form.value?.querySelector('textarea')
  if (!field) return
  field.focus()
  field.setSelectionRange(field.value.length, field.value.length)
})
onBeforeUnmount(() => {
  alive = false
})

// The comment's own mentions name their users even when the member list is not loaded yet or they left the
// project, so the editor shows `@Name` instead of the raw `<@id>` token; they are never suggested.
const editorMentions = computed<MarkdownMentionOptions>(() => ({ ...props.mentions, known: props.comment.mentions }))

const removedStillAttached = computed(() =>
  removedIds.value.filter((id) => props.comment.attachments.some((attachment) => attachment.id === id)),
)
const changed = computed(() => draft.value.trim() !== props.comment.body.trim() || removedStillAttached.value.length > 0)
const canSave = computed(
  () => !saving.value && changed.value && draft.value.trim() !== '' && charCount(draft.value) <= TASK_DESCRIPTION_MAX_LENGTH,
)

function isRemoved(id: number): boolean {
  return removedIds.value.includes(id)
}

function toggleRemoved(id: number): void {
  errorText.value = null
  removedIds.value = isRemoved(id) ? removedIds.value.filter((value) => value !== id) : [...removedIds.value, id]
}

async function save(): Promise<void> {
  if (!canSave.value) return
  saving.value = true
  errorText.value = null
  try {
    const updated = await updateTaskComment(props.projectId, props.taskId, props.comment.id, draft.value.trim(), removedStillAttached.value)
    if (!alive) return
    store.update(updated)
    emit('done')
  } catch (caught) {
    if (!alive) return
    if (!(caught instanceof ApiError)) throw caught
    if (caught.status === 422) errorText.value = caught.errors?.body?.[0] ?? caught.message
    else if (caught.status === 429) errorText.value = t('taskComments.tooManyAttempts')
    else if (caught.status === 0) errorText.value = t('taskComments.network')
    else if (caught.status === 403) errorText.value = t('taskComments.editForbidden')
    else if (caught.status === 404) errorText.value = t('taskComments.editGone')
    else errorText.value = t('taskComments.editFailed')
  } finally {
    if (alive) saving.value = false
  }
}

function cancel(): void {
  if (!saving.value) emit('done')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
  event.preventDefault()
  event.stopPropagation()
  cancel()
}
</script>

<template>
  <form ref="form" class="comment-editor" novalidate data-test="comment-editor" @submit.prevent="save" @keydown="onKeydown">
    <label class="comment-editor__label" :for="fieldId">{{ t('taskComments.editLabel') }}</label>
    <MarkdownEditor
      :id="fieldId"
      v-model="draft"
      name="comment-edit"
      :rows="3"
      :max-length="TASK_DESCRIPTION_MAX_LENGTH"
      :readonly="saving"
      :mentions="editorMentions"
    />
    <ul v-if="comment.attachments.length > 0" class="comment-editor__attachments" :aria-label="t('message.attachmentsLabel')">
      <li v-for="attachment in comment.attachments" :key="attachment.id" class="comment-editor__attachment" data-test="edit-attachment">
        <span :class="{ 'comment-editor__name--removed': isRemoved(attachment.id) }">{{ attachment.original_name }}</span>
        <button
          type="button"
          class="comment-editor__button"
          data-test="edit-attachment-toggle"
          :disabled="saving"
          :aria-label="t(isRemoved(attachment.id) ? 'message.keepAttachmentNamed' : 'message.removeAttachmentNamed', { name: attachment.original_name })"
          @click="toggleRemoved(attachment.id)"
        >
          {{ isRemoved(attachment.id) ? t('message.keepAttachment') : t('message.removeAttachment') }}
        </button>
      </li>
    </ul>
    <AppFormError v-if="errorText" data-test="edit-error">{{ errorText }}</AppFormError>
    <div class="comment-editor__bar">
      <button type="button" class="comment-editor__button" data-test="edit-cancel" :disabled="saving" @click="cancel">
        {{ t('message.cancel') }}
      </button>
      <button type="submit" class="comment-editor__button comment-editor__button--primary" data-test="edit-save" :disabled="!canSave">
        {{ saving ? t('taskComments.saving') : t('message.save') }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.comment-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
}
.comment-editor__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.comment-editor__attachments {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.comment-editor__attachment {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.comment-editor__attachment span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.comment-editor__name--removed {
  text-decoration: line-through;
  color: var(--ink-3);
}
.comment-editor__bar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.comment-editor__button {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}
.comment-editor__button--primary {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--surface);
  font-weight: 600;
}
.comment-editor__button:disabled {
  opacity: 0.6;
  cursor: default;
}
.comment-editor__button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
