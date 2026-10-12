<script setup lang="ts">
import { Bold, Code, Heading, Italic, Link, List, ListOrdered, Quote } from '@lucide/vue'
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMentionInput, type InsertedMention, type MentionCandidate } from '../composables/useMentionInput'
import { useMentionKeyboard } from '../composables/useMentionKeyboard'
import { parseMentionDraft } from '../mentionToken'
import { isApple } from '../platform'
import { formatLines, toggleCode, toggleLink, wrapSelection, type TextEdit } from '../markdown/markdownFormat'
import AppSegmented from './ui/AppSegmented.vue'
import AppTooltip from './ui/AppTooltip.vue'
import MarkdownContent from './MarkdownContent.vue'
import { charCount, TASK_DESCRIPTION_MAX_LENGTH } from './taskLimits'

export interface MarkdownMentionOptions {
  members: readonly (MentionCandidate & { email?: string })[]
  excludeUserId?: number | null
  /** Called when an `@` query appears, to load the member list. */
  ensureLoaded?: () => unknown
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    maxLength?: number
    readonly?: boolean
    id?: string
    name?: string
    rows?: number
    ariaInvalid?: 'true'
    ariaDescribedby?: string
    /** Enables `@` autocompletion; `modelValue` then carries `<@id>` tokens and the field shows `@Name`. */
    mentions?: MarkdownMentionOptions
  }>(),
  { maxLength: TASK_DESCRIPTION_MAX_LENGTH, readonly: false, rows: 6 },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useI18n()
const mode = ref('write')
const textarea = ref<HTMLTextAreaElement | null>(null)
const listId = useId()

const mentionsEnabled = computed(() => props.mentions !== undefined)
const mention = useMentionInput({
  members: () => props.mentions?.members ?? [],
  excludeUserId: () => props.mentions?.excludeUserId,
})
const {
  activeIndex,
  open: suggestionsOpen,
  optionId,
  syncCaret,
  choose,
  handleKeydown: handleMentionKeydown,
} = useMentionKeyboard({
  mention,
  field: textarea,
  listId,
  ensureLoaded: () => props.mentions?.ensureLoaded?.(),
})
const open = computed(() => mentionsEnabled.value && mode.value === 'write' && suggestionsOpen.value)
const previewMentions = computed(() =>
  mentionsEnabled.value ? mention.mentions.value.map(({ id, name }) => ({ id, name })) : undefined,
)

watch(
  () => (mentionsEnabled.value ? props.modelValue : null),
  (value) => {
    if (value === null || value === mention.serialized.value) return
    const known = [...mention.mentions.value, ...(props.mentions?.members ?? [])]
    mention.restore(parseMentionDraft(value, known))
  },
  { immediate: true },
)
watch(
  () => mention.serialized.value,
  (serialized) => {
    if (mentionsEnabled.value && serialized !== props.modelValue) emit('update:modelValue', serialized)
  },
)

const count = computed(() => charCount(props.modelValue))
const overLimit = computed(() => count.value > props.maxLength)
const modeOptions = computed(() => [
  { value: 'write', label: t('markdownEditor.write') },
  { value: 'preview', label: t('markdownEditor.preview') },
])

type Action = (value: string, start: number, end: number) => TextEdit

const actions: { key: string; icon: typeof Bold; shortcut?: string; run: Action }[] = [
  { key: 'bold', icon: Bold, shortcut: 'B', run: (v, s, e) => wrapSelection(v, s, e, '**') },
  { key: 'italic', icon: Italic, shortcut: 'I', run: (v, s, e) => wrapSelection(v, s, e, '_') },
  { key: 'heading', icon: Heading, run: (v, s, e) => formatLines(v, s, e, 'heading') },
  { key: 'bulletList', icon: List, run: (v, s, e) => formatLines(v, s, e, 'bullet') },
  { key: 'numberedList', icon: ListOrdered, run: (v, s, e) => formatLines(v, s, e, 'numbered') },
  { key: 'quote', icon: Quote, run: (v, s, e) => formatLines(v, s, e, 'quote') },
  { key: 'code', icon: Code, run: toggleCode },
  { key: 'link', icon: Link, shortcut: 'K', run: toggleLink },
]

function tooltipText(action: { key: string; shortcut?: string }) {
  const name = t(`markdownEditor.${action.key}`)
  return action.shortcut ? `${name} (${isApple ? '⌘' : 'Ctrl+'}${action.shortcut})` : name
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff

function replaceThroughHistory(el: HTMLTextAreaElement, next: string): boolean {
  if (typeof document.execCommand !== 'function') return false
  const current = el.value
  let prefix = 0
  const shared = Math.min(current.length, next.length)
  while (prefix < shared && current[prefix] === next[prefix]) prefix++
  if (
    prefix > 0 &&
    isHighSurrogate(current.charCodeAt(prefix - 1)) &&
    (isLowSurrogate(current.charCodeAt(prefix)) || isLowSurrogate(next.charCodeAt(prefix)))
  ) {
    prefix--
  }
  let suffix = 0
  while (suffix < shared - prefix && current[current.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++
  if (
    suffix > 0 &&
    isLowSurrogate(current.charCodeAt(current.length - suffix)) &&
    (isHighSurrogate(current.charCodeAt(current.length - suffix - 1)) ||
      isHighSurrogate(next.charCodeAt(next.length - suffix - 1)))
  ) {
    suffix--
  }
  if (prefix + suffix === current.length && prefix + suffix === next.length) return true
  const inserted = next.slice(prefix, next.length - suffix)
  el.setSelectionRange(prefix, current.length - suffix)
  const handled = inserted === '' ? document.execCommand('delete') : document.execCommand('insertText', false, inserted)
  return handled && el.value === next
}

/**
 * Runs the action again with each mention masked as a run of one private-use character, so the mentions that the
 * edit only moves (bold around them, a list prefix) keep their link; one the edit splits is dropped.
 */
function mentionsAfter(run: Action, value: string, start: number, end: number, next: string): InsertedMention[] {
  const runs = mention.mentions.value.map((m, i) => String.fromCharCode(0xe000 + i).repeat(m.end - m.start))
  let masked = value
  mention.mentions.value.forEach((m, i) => {
    masked = masked.slice(0, m.start) + runs[i] + masked.slice(m.end)
  })
  const result = run(masked, start, end).value
  const kept: InsertedMention[] = []
  mention.mentions.value.forEach((m, i) => {
    const at = result.indexOf(runs[i])
    const whole = result.split(runs[i][0]).length - 1 === runs[i].length
    if (at >= 0 && whole && next.slice(at, at + runs[i].length) === `@${m.name}`) {
      kept.push({ ...m, start: at, end: at + runs[i].length })
    }
  })
  return kept
}

async function apply(run: Action) {
  const el = textarea.value
  if (!el || props.readonly) return
  const { selectionStart, selectionEnd } = el
  const edit = run(el.value, selectionStart, selectionEnd)
  const kept = mentionsEnabled.value ? mentionsAfter(run, el.value, selectionStart, selectionEnd, edit.value) : []
  el.focus()
  const replaced = replaceThroughHistory(el, edit.value)
  if (mentionsEnabled.value) mention.restore({ text: edit.value, mentions: kept })
  else if (!replaced) emit('update:modelValue', edit.value)
  await nextTick()
  el.focus()
  el.setSelectionRange(edit.selectionStart, edit.selectionEnd)
}

function onKeydown(event: KeyboardEvent) {
  if (mentionsEnabled.value && !event.isComposing && handleMentionKeydown(event)) return
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
  const action = actions.find((a) => a.shortcut?.toLowerCase() === event.key.toLowerCase())
  if (!action) return
  event.preventDefault()
  void apply(action.run)
}

function onInput(event: Event) {
  const el = event.target as HTMLTextAreaElement
  if (mentionsEnabled.value) mention.update(el.value, el.selectionStart)
  else emit('update:modelValue', el.value)
}

function onCaretMove() {
  if (mentionsEnabled.value) syncCaret()
}

function onBlur() {
  if (mentionsEnabled.value) mention.moveCaret(null)
}
</script>

<template>
  <div class="markdown-editor">
    <div class="markdown-editor__head">
      <AppSegmented v-model="mode" :options="modeOptions" :label="t('markdownEditor.modeLabel')" />
      <div v-show="mode === 'write'" class="markdown-editor__toolbar" role="toolbar" :aria-label="t('markdownEditor.toolbar')">
        <AppTooltip v-for="action in actions" :key="action.key" :text="tooltipText(action)">
          <button
            type="button"
            class="markdown-editor__tool"
            :data-test="`tool-${action.key}`"
            :aria-label="t(`markdownEditor.${action.key}`)"
            :aria-keyshortcuts="action.shortcut ? `${isApple ? 'Meta' : 'Control'}+${action.shortcut}` : undefined"
            :disabled="readonly"
            @mousedown.prevent
            @click="apply(action.run)"
          >
            <component :is="action.icon" :size="16" aria-hidden="true" />
          </button>
        </AppTooltip>
      </div>
    </div>

    <textarea
      v-show="mode === 'write'"
      :id="id"
      ref="textarea"
      class="markdown-editor__input"
      :name="name"
      :rows="rows"
      :value="mentionsEnabled ? mention.text.value : modelValue"
      :readonly="readonly"
      :aria-invalid="ariaInvalid"
      :aria-describedby="ariaDescribedby"
      :role="mentionsEnabled ? 'combobox' : undefined"
      :aria-autocomplete="mentionsEnabled ? 'list' : undefined"
      :aria-haspopup="mentionsEnabled ? 'listbox' : undefined"
      :aria-expanded="mentionsEnabled ? open : undefined"
      :aria-controls="mentionsEnabled ? listId : undefined"
      :aria-activedescendant="open ? optionId(activeIndex) : undefined"
      @input="onInput"
      @keydown="onKeydown"
      @keyup="onCaretMove"
      @click="onCaretMove"
      @blur="onBlur"
    ></textarea>

    <template v-if="mentionsEnabled">
      <ul
        v-show="open"
        :id="listId"
        role="listbox"
        class="markdown-editor__suggestions"
        :aria-label="t('channel.composer.suggestions')"
      >
        <li
          v-for="(member, index) in mention.suggestions.value"
          :id="optionId(index)"
          :key="member.id"
          role="option"
          class="markdown-editor__option"
          :class="{ 'markdown-editor__option--active': index === activeIndex }"
          :aria-selected="index === activeIndex"
          @mousedown.prevent
          @click="choose(index)"
        >
          <span>{{ member.name }}</span>
          <span v-if="member.email" class="markdown-editor__option-email">{{ member.email }}</span>
        </li>
      </ul>
      <span class="markdown-editor__sr" role="status">
        {{ open ? t('channel.composer.suggestionsCount', { n: mention.suggestions.value.length }) : '' }}
      </span>
    </template>

    <div v-if="mode === 'preview'" class="markdown-editor__preview" data-test="preview">
      <MarkdownContent :source="modelValue" :mentions="previewMentions" />
      <p v-if="modelValue.trim() === ''" class="markdown-editor__empty">{{ t('markdownEditor.previewEmpty') }}</p>
    </div>

    <p class="markdown-editor__count" :class="{ 'markdown-editor__count--over': overLimit }" data-test="count">
      {{ t('markdownEditor.count', { count, max: maxLength }) }}
    </p>
  </div>
</template>

<style scoped>
.markdown-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}
.markdown-editor__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.markdown-editor__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
.markdown-editor__tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}
.markdown-editor__tool:hover:not(:disabled) {
  background: var(--bg);
  color: var(--ink);
}
.markdown-editor__tool:disabled {
  color: var(--ink-3);
  cursor: default;
}
.markdown-editor__tool:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.markdown-editor__input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  resize: vertical;
}
.markdown-editor__input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.markdown-editor__suggestions {
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
}
.markdown-editor__option {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 6px 8px;
  border-radius: var(--radius-control);
  color: var(--ink);
  cursor: pointer;
}
.markdown-editor__option--active {
  background: var(--accent-soft);
  color: var(--accent-ink);
}
.markdown-editor__option-email {
  overflow: hidden;
  font-size: 12px;
  color: var(--ink-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.markdown-editor__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.markdown-editor__preview {
  min-height: 120px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}
.markdown-editor__empty {
  margin: 0;
  color: var(--ink-3);
}
.markdown-editor__count {
  margin: 0;
  color: var(--ink-3);
  font-size: 12px;
  text-align: right;
}
.markdown-editor__count--over {
  color: var(--level-error-fg);
}
</style>
