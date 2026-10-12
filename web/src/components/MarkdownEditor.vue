<script setup lang="ts">
import { Bold, Code, Heading, Italic, Link, List, ListOrdered, Quote } from '@lucide/vue'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { isApple } from '../platform'
import { formatLines, toggleCode, toggleLink, wrapSelection, type TextEdit } from '../markdown/markdownFormat'
import AppSegmented from './ui/AppSegmented.vue'
import AppTooltip from './ui/AppTooltip.vue'
import MarkdownContent from './MarkdownContent.vue'
import { charCount, TASK_DESCRIPTION_MAX_LENGTH } from './taskLimits'

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
  }>(),
  { maxLength: TASK_DESCRIPTION_MAX_LENGTH, readonly: false, rows: 6 },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useI18n()
const mode = ref('write')
const textarea = ref<HTMLTextAreaElement | null>(null)

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

function replaceThroughHistory(el: HTMLTextAreaElement, next: string): boolean {
  if (typeof document.execCommand !== 'function') return false
  const current = el.value
  let prefix = 0
  const shared = Math.min(current.length, next.length)
  while (prefix < shared && current[prefix] === next[prefix]) prefix++
  let suffix = 0
  while (suffix < shared - prefix && current[current.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++
  if (prefix + suffix === current.length && prefix + suffix === next.length) return true
  const inserted = next.slice(prefix, next.length - suffix)
  el.setSelectionRange(prefix, current.length - suffix)
  return inserted === '' ? document.execCommand('delete') : document.execCommand('insertText', false, inserted)
}

async function apply(run: Action) {
  const el = textarea.value
  if (!el || props.readonly) return
  const edit = run(el.value, el.selectionStart, el.selectionEnd)
  el.focus()
  if (!replaceThroughHistory(el, edit.value)) emit('update:modelValue', edit.value)
  await nextTick()
  el.focus()
  el.setSelectionRange(edit.selectionStart, edit.selectionEnd)
}

function onKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
  const action = actions.find((a) => a.shortcut?.toLowerCase() === event.key.toLowerCase())
  if (!action) return
  event.preventDefault()
  void apply(action.run)
}

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
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
      :value="modelValue"
      :readonly="readonly"
      :aria-invalid="ariaInvalid"
      :aria-describedby="ariaDescribedby"
      @input="onInput"
      @keydown="onKeydown"
    ></textarea>

    <div v-if="mode === 'preview'" class="markdown-editor__preview" data-test="preview">
      <MarkdownContent :source="modelValue" />
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
