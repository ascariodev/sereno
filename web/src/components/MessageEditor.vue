<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { updateMessage } from '../api/messages'
import { ApiError } from '../api/client'
import type { Message } from '../api/types'
import { useMentionInput } from '../composables/useMentionInput'
import { useMentionKeyboard } from '../composables/useMentionKeyboard'
import { parseMentionDraft } from '../mentionToken'
import { useAuthStore } from '../stores/auth'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useMessagesStore } from '../stores/messages'
import { useProjectsStore } from '../stores/projects'
import { useThreadStore } from '../stores/thread'

const MAX_LENGTH = 4000

const props = defineProps<{ message: Message }>()
const emit = defineEmits<{ done: [] }>()

const { t } = useI18n()
const hintId = useId()
const listId = useId()
const errorDomId = `${listId}-error`
const directory = useMemberDirectoryStore()
const projects = useProjectsStore()
const auth = useAuthStore()
const messages = useMessagesStore()
const thread = useThreadStore()
const field = ref<HTMLTextAreaElement | null>(null)
const saving = ref(false)
const errorText = ref<string | null>(null)
let alive = true
const projectId = computed(() => projects.projectIdOfChannel(props.message.channel_id))

const mention = useMentionInput({
  members: () => directory.membersOf(projectId.value),
  excludeUserId: () => auth.user?.id,
})
mention.restore(parseMentionDraft(props.message.body ?? '', props.message.mentions))

const { activeIndex, open, optionId, syncCaret, choose, handleKeydown } = useMentionKeyboard({
  mention,
  field,
  listId,
  ensureLoaded: () => directory.ensureLoaded(projectId.value),
})
const tooLong = computed(() => mention.length.value > MAX_LENGTH)
const removedIds = ref<number[]>([])
const keptCount = computed(() => props.message.attachments.length - removedIds.value.length)
const hasText = computed(() => mention.serialized.value.trim() !== '')
const canSave = computed(() => !saving.value && !tooLong.value && (hasText.value || keptCount.value > 0))

function isRemoved(id: number): boolean {
  return removedIds.value.includes(id)
}

function toggleRemoved(id: number): void {
  errorText.value = null
  removedIds.value = isRemoved(id) ? removedIds.value.filter((value) => value !== id) : [...removedIds.value, id]
}

function cannotRemove(id: number): boolean {
  return saving.value || (!isRemoved(id) && !hasText.value && keptCount.value <= 1)
}
const errorMessage = computed(() => (tooLong.value ? t('channel.composer.tooLong', { max: MAX_LENGTH }) : errorText.value))
const describedBy = computed(() => (errorMessage.value ? `${hintId} ${errorDomId}` : hintId))

onMounted(() => {
  const el = field.value
  if (!el) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
})
onBeforeUnmount(() => {
  alive = false
})

function onInput(event: Event): void {
  const el = event.target as HTMLTextAreaElement
  errorText.value = null
  mention.update(el.value, el.selectionStart)
}

async function save(): Promise<void> {
  if (!canSave.value) return
  const body = mention.serialized.value
  if (body === (props.message.body ?? '') && removedIds.value.length === 0) {
    emit('done')
    return
  }
  saving.value = true
  errorText.value = null
  try {
    const updated = await updateMessage(props.message.channel_id, props.message.id, body, removedIds.value)
    // Left the channel while saving (L-32): the stores belong to another one now.
    if (!alive) return
    messages.replace(updated)
    thread.replace(updated)
    emit('done')
  } catch (caught) {
    if (!alive) return
    const status = caught instanceof ApiError ? caught.status : 0
    if (status === 422) errorText.value = (caught as ApiError).errors?.body?.[0] ?? (caught as ApiError).message
    else if (status === 429) errorText.value = t('channel.composer.rateLimited')
    else if (status === 403) errorText.value = t('message.editForbidden')
    else if (status === 404) errorText.value = t('message.editGone')
    else errorText.value = t('message.editFailed')
  } finally {
    saving.value = false
  }
}

function cancel(): void {
  if (!saving.value) emit('done')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (handleKeydown(event)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancel()
    return
  }
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  void save()
}
</script>

<template>
  <form class="message-editor" @submit.prevent="save">
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
      :aria-label="t('message.editLabel')"
      :aria-describedby="describedBy"
      :aria-invalid="errorMessage ? 'true' : undefined"
      @input="onInput"
      @keydown="onKeydown"
      @keyup="syncCaret"
      @click="syncCaret"
      @blur="mention.moveCaret(null)"
    />
    <ul v-if="message.attachments.length > 0" class="message-editor__attachments" :aria-label="t('message.attachmentsLabel')">
      <li v-for="attachment in message.attachments" :key="attachment.id" class="message-editor__attachment">
        <span :class="{ 'message-editor__name--removed': isRemoved(attachment.id) }">{{ attachment.original_name }}</span>
        <button
          type="button"
          name="remove-attachment"
          class="message-editor__button"
          :disabled="cannotRemove(attachment.id)"
          :aria-label="t(isRemoved(attachment.id) ? 'message.keepAttachmentNamed' : 'message.removeAttachmentNamed', { name: attachment.original_name })"
          @click="toggleRemoved(attachment.id)"
        >
          {{ isRemoved(attachment.id) ? t('message.keepAttachment') : t('message.removeAttachment') }}
        </button>
      </li>
    </ul>
    <ul v-show="open" :id="listId" role="listbox" class="message-editor__suggestions" :aria-label="t('channel.composer.suggestions')">
      <li
        v-for="(member, index) in mention.suggestions.value"
        :id="optionId(index)"
        :key="member.id"
        role="option"
        class="message-editor__option"
        :class="{ 'message-editor__option--active': index === activeIndex }"
        :aria-selected="index === activeIndex"
        @mousedown.prevent
        @click="choose(index)"
      >
        <span>{{ member.name }}</span>
        <span class="message-editor__email">{{ member.email }}</span>
      </li>
    </ul>
    <span class="sr-only" role="status">
      {{ open ? t('channel.composer.suggestionsCount', { n: mention.suggestions.value.length }) : '' }}
    </span>
    <p :id="errorDomId" class="message-editor__error" :role="errorMessage ? 'alert' : undefined">{{ errorMessage }}</p>
    <div class="message-editor__bar">
      <span :id="hintId" class="message-editor__hint">{{ t('message.editHint') }}</span>
      <button type="button" name="cancel-edit" class="message-editor__button" :disabled="saving" @click="cancel">
        {{ t('message.cancel') }}
      </button>
      <button type="submit" name="save-edit" class="message-editor__button message-editor__button--primary" :disabled="!canSave">
        {{ t('message.save') }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.message-editor {
  display: grid;
  gap: var(--space-2);
  margin-top: 2px;
}

.message-editor textarea {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  resize: none;
}

.message-editor textarea:focus-visible {
  outline: 2px solid var(--accent-ink);
  outline-offset: 1px;
}

.message-editor__suggestions {
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
}

.message-editor__option {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 6px 8px;
  border-radius: var(--radius-control);
  color: var(--ink);
  cursor: pointer;
}

.message-editor__option--active {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.message-editor__email {
  font-size: 12px;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-editor__attachments {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.message-editor__attachment {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.message-editor__attachment span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-editor__name--removed {
  text-decoration: line-through;
  color: var(--ink-3);
}

.message-editor__error {
  margin: 0;
  font-size: 12px;
  color: var(--level-error-fg);
}

.message-editor__error:empty {
  display: none;
}

.message-editor__bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.message-editor__hint {
  flex: 1;
  font-size: 12px;
  color: var(--ink-3);
}

.message-editor__button {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}

.message-editor__button--primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}

.message-editor__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.message-editor__button:focus-visible {
  outline: 2px solid var(--accent-ink);
  outline-offset: 2px;
}
</style>
