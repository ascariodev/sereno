<script setup lang="ts">
import { computed, onUpdated, ref, watch } from 'vue'
import { renderMarkdown } from '../markdown/renderMarkdown'

const props = defineProps<{ source: string | null | undefined; interactive?: boolean }>()
const emit = defineEmits<{ toggle: [lineIndex: number] }>()

const html = computed(() => renderMarkdown(props.source ?? '', { interactive: props.interactive }))

const root = ref<HTMLElement | null>(null)
let focusedLine: string | null = null

watch(
  html,
  () => {
    const active = document.activeElement
    focusedLine = active instanceof HTMLInputElement && root.value?.contains(active) ? (active.dataset.taskLine ?? null) : null
  },
  { flush: 'pre' },
)

onUpdated(() => {
  if (focusedLine === null) return
  root.value?.querySelector<HTMLInputElement>(`input[data-task-line="${focusedLine}"]`)?.focus()
  focusedLine = null
})

function onChange(event: Event): void {
  const box = event.target
  if (!props.interactive || !(box instanceof HTMLInputElement) || box.type !== 'checkbox') return
  box.checked = !box.checked
  const line = box.dataset.taskLine
  if (line !== undefined) emit('toggle', Number(line))
}
</script>

<template>
  <div v-if="html" ref="root" class="markdown-content" @change="onChange" v-html="html"></div>
</template>

<style scoped>
.markdown-content {
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.markdown-content > :deep(:first-child) {
  margin-top: 0;
}
.markdown-content > :deep(:last-child) {
  margin-bottom: 0;
}
.markdown-content :deep(p),
.markdown-content :deep(ul),
.markdown-content :deep(ol),
.markdown-content :deep(blockquote),
.markdown-content :deep(pre) {
  margin: 0 0 var(--space-2);
}
.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin: var(--space-3) 0 var(--space-2);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
}
.markdown-content :deep(h4) {
  font-size: 14px;
}
.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: var(--space-5);
}
.markdown-content :deep(a) {
  color: var(--accent-ink);
  text-decoration: underline;
}
.markdown-content :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.markdown-content :deep(pre) {
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  overflow-x: auto;
}
.markdown-content :deep(pre code) {
  padding: 0;
  background: none;
}
.markdown-content :deep(blockquote) {
  padding-left: var(--space-3);
  border-left: 3px solid var(--border);
  color: var(--ink-2);
}
.markdown-content :deep(li:has(> input[type='checkbox'])) {
  list-style: none;
  margin-left: calc(-1 * var(--space-4));
}
.markdown-content :deep(input[type='checkbox']) {
  margin: 0 var(--space-2) 0 0;
  vertical-align: middle;
  accent-color: var(--accent);
}
.markdown-content :deep(input[type='checkbox']:not(:disabled)) {
  cursor: pointer;
}
.markdown-content :deep(input[type='checkbox']:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.markdown-content :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border);
}
</style>
