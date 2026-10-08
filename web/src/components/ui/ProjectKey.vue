<script setup lang="ts">
defineProps<{ value: string }>()
</script>

<template>
  <span class="project-key">{{ value }}</span>
</template>

<style scoped>
.project-key {
  display: inline-block;
  padding: 3px 6px;
  border-radius: var(--radius-chip);
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
}
</style>
