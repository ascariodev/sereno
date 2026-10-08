<script lang="ts">
export interface AppSegmentedOption {
  value: string
  label: string
  count?: number
  disabled?: boolean
  ariaLabel?: string
  lang?: string
}
</script>

<script setup lang="ts">
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'

defineProps<{ modelValue: string; options: AppSegmentedOption[]; label: string }>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function onUpdate(value: unknown) {
  if (typeof value === 'string' && value !== '') {
    emit('update:modelValue', value)
  }
}
</script>

<template>
  <ToggleGroupRoot
    class="app-segmented"
    type="single"
    :model-value="modelValue"
    :aria-label="label"
    @update:model-value="onUpdate"
  >
    <ToggleGroupItem
      v-for="option in options"
      :key="option.value"
      class="app-segmented__item"
      :value="option.value"
      :disabled="option.disabled"
      :aria-label="option.ariaLabel"
      :lang="option.lang"
    >
      <span>{{ option.label }}</span>
      <span v-if="option.count !== undefined" class="app-segmented__count">
        <span class="app-segmented__sep">, </span>{{ option.count }}
      </span>
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>

<style>
.app-segmented {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: var(--bg);
  border-radius: 10px;
}
.app-segmented__item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-2);
  font-weight: 500;
  cursor: pointer;
}
.app-segmented__item[data-state='on'] {
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(21, 23, 28, 0.08);
}
.app-segmented__item[data-disabled] {
  color: var(--ink-3);
  cursor: default;
}
.app-segmented__item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.app-segmented__sep {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.app-segmented__count {
  color: var(--ink-3);
  font-weight: 500;
}
</style>
