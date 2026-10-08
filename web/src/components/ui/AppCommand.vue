<script lang="ts">
import type { Component } from 'vue'

export interface AppCommandItem {
  value: string
  label: string
  hint?: string
  keywords?: string[]
  icon?: Component
}

export interface AppCommandGroup {
  label: string
  items: AppCommandItem[]
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase()
}
</script>

<script setup lang="ts">
import { Search } from '@lucide/vue'
import { ListboxContent, ListboxFilter, ListboxGroup, ListboxGroupLabel, ListboxItem, ListboxRoot } from 'reka-ui'
import { computed, ref, useId, watch } from 'vue'
import AppDialog from './AppDialog.vue'

const props = defineProps<{
  title: string
  placeholder: string
  emptyText: string
  groups: AppCommandGroup[]
}>()

const emit = defineEmits<{ select: [value: string] }>()

const open = defineModel<boolean>('open', { default: false })
const query = ref('')
const listId = useId()

watch(open, (isOpen) => {
  if (isOpen) query.value = ''
})

const visibleGroups = computed(() => {
  const terms = normalize(query.value).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return props.groups.filter((group) => group.items.length > 0)
  return props.groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const haystack = normalize([item.label, item.hint ?? '', ...(item.keywords ?? [])].join(' '))
        return terms.every((term) => haystack.includes(term))
      }),
    }))
    .filter((group) => group.items.length > 0)
})

function choose(value: string): void {
  open.value = false
  emit('select', value)
}
</script>

<template>
  <AppDialog v-model:open="open" :title="title" hide-title>
    <ListboxRoot class="app-command">
      <div class="app-command__field">
        <Search class="app-command__search-icon" :size="17" aria-hidden="true" />
        <ListboxFilter
          v-model="query"
          class="app-command__input"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          :aria-controls="listId"
          :aria-label="placeholder"
          :placeholder="placeholder"
          auto-focus
        />
      </div>
      <ListboxContent :id="listId" class="app-command__list" :aria-label="title">
        <ListboxGroup v-for="group in visibleGroups" :key="group.label" class="app-command__group">
          <ListboxGroupLabel class="app-command__group-label">{{ group.label }}</ListboxGroupLabel>
          <ListboxItem
            v-for="item in group.items"
            :key="item.value"
            :value="item.value"
            :data-value="item.value"
            class="app-command__item"
            @select="choose(item.value)"
          >
            <component :is="item.icon" v-if="item.icon" class="app-command__icon" :size="16" aria-hidden="true" />
            <span class="app-command__label">{{ item.label }}</span>
            <span v-if="item.hint" class="app-command__hint">{{ item.hint }}</span>
          </ListboxItem>
        </ListboxGroup>
      </ListboxContent>
      <p class="app-command__empty" role="status">{{ visibleGroups.length === 0 ? emptyText : '' }}</p>
    </ListboxRoot>
  </AppDialog>
</template>

<style>
.app-command {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.app-command__field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--bg);
}
.app-command__field:focus-within {
  border-color: var(--accent);
}
.app-command__search-icon {
  flex: none;
  color: var(--ink-3);
}
.app-command__input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 15px;
  outline: none;
}
.app-command__list {
  max-height: min(360px, 55dvh);
  overflow-y: auto;
  outline: none;
}
.app-command__group + .app-command__group {
  margin-top: var(--space-2);
}
.app-command__group-label {
  padding: var(--space-1) var(--space-2);
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-3);
}
.app-command__item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-control);
  color: var(--ink-2);
  cursor: pointer;
  outline: none;
}
.app-command__item[data-highlighted] {
  background: var(--accent-soft);
  color: var(--accent-ink);
}
.app-command__icon {
  flex: none;
}
.app-command__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-command__hint {
  flex: none;
  font-size: 12px;
  color: var(--ink-3);
}
.app-command__empty:empty {
  padding: 0;
}
.app-command__empty {
  margin: 0;
  padding: var(--space-4) var(--space-2);
  text-align: center;
  font-size: 13.5px;
  color: var(--ink-3);
}
</style>
