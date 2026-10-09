<script setup lang="ts">
import { AtSign, SendHorizontal } from '@lucide/vue'
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { useMentionInput } from '../composables/useMentionInput'
import { useAuthStore } from '../stores/auth'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useMessagesStore } from '../stores/messages'

const MAX_LENGTH = 4000

const props = defineProps<{ send?: (body: string) => Promise<void>; placeholder?: string }>()

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

const mention = useMentionInput({
  members: () => directory.members,
  excludeUserId: () => auth.user?.id,
})

const open = computed(() => mention.suggestions.value.length > 0)
const tooLong = computed(() => mention.length.value > MAX_LENGTH)
const canSend = computed(() => !sending.value && !tooLong.value && mention.serialized.value.trim() !== '')

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

async function submit(): Promise<void> {
  if (!canSend.value) return
  sending.value = true
  errorText.value = null
  const sentText = mention.text.value
  const sentBody = mention.serialized.value
  try {
    await (props.send ?? messages.send)(sentBody)
    if (mention.text.value === sentText) mention.reset()
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
    <div class="composer-box">
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
      />
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
      <span v-if="open" class="composer-sr" role="status">
        {{ t('channel.composer.suggestionsCount', { n: mention.suggestions.value.length }) }}
      </span>
      <div class="composer-bar">
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

.composer-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
