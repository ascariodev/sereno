<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../markdown/renderMarkdown'

const props = defineProps<{ source: string | null | undefined }>()

const html = computed(() => renderMarkdown(props.source ?? ''))
</script>

<template>
  <div v-if="html" class="markdown-content" v-html="html"></div>
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
.markdown-content :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border);
}
</style>
