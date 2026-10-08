<script lang="ts">
import type { LucideIcon } from '@lucide/vue'

export interface AppMenuItem {
  value: string
  label: string
  icon?: LucideIcon
  disabled?: boolean
  danger?: boolean
  checked?: boolean
}
</script>

<script setup lang="ts">
import { Check } from '@lucide/vue'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'

withDefaults(defineProps<{ items: AppMenuItem[]; align?: 'start' | 'center' | 'end'; side?: 'top' | 'right' | 'bottom' | 'left' }>(), {
  align: 'start',
  side: 'bottom',
})

const emit = defineEmits<{ select: [value: string] }>()
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger as-child>
      <slot />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent class="app-menu" :side="side" :align="align" :side-offset="6" :collision-padding="8">
        <component
          :is="item.checked === undefined ? DropdownMenuItem : DropdownMenuCheckboxItem"
          v-for="item in items"
          :key="item.value"
          class="app-menu__item"
          :class="{ 'app-menu__item--danger': item.danger }"
          :disabled="item.disabled"
          :text-value="item.label"
          :data-value="item.value"
          v-bind="item.checked === undefined ? {} : { modelValue: item.checked }"
          @select="emit('select', item.value)"
        >
          <component :is="item.icon" v-if="item.icon" class="app-menu__icon" :size="16" aria-hidden="true" />
          <span class="app-menu__label">{{ item.label }}</span>
          <Check v-if="item.checked" class="app-menu__check" :size="15" aria-hidden="true" />
        </component>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<style>
.app-menu {
  min-width: 200px;
  max-height: var(--reka-dropdown-menu-content-available-height);
  overflow-y: auto;
  padding: var(--space-1);
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  box-shadow: 0 8px 24px rgba(21, 23, 28, 0.12);
  transform-origin: var(--reka-dropdown-menu-content-transform-origin);
  z-index: 50;
}
.app-menu[data-state='open'] {
  animation: app-menu-in 120ms ease-out;
}
.app-menu[data-state='closed'] {
  animation: app-menu-out 90ms ease-in;
}
.app-menu__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 7px 10px;
  border-radius: var(--radius-chip);
  font-size: 13.5px;
  color: var(--ink);
  cursor: pointer;
  outline: none;
  user-select: none;
}
.app-menu__item[data-highlighted] {
  background: var(--accent-soft);
  color: var(--accent-ink);
}
.app-menu__item[data-disabled] {
  color: var(--ink-3);
  cursor: default;
  pointer-events: none;
}
.app-menu__item--danger,
.app-menu__item--danger[data-highlighted] {
  color: var(--level-error-fg);
}
.app-menu__label {
  flex: 1;
}
.app-menu__check {
  flex: none;
  color: var(--accent-ink);
}
.app-menu__icon {
  flex: none;
  color: var(--ink-3);
}
.app-menu__item[data-highlighted] .app-menu__icon,
.app-menu__item--danger .app-menu__icon {
  color: inherit;
}
@keyframes app-menu-in {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
@keyframes app-menu-out {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateY(-4px) scale(0.98); }
}
@media (prefers-reduced-motion: reduce) {
  .app-menu[data-state] { animation: none; }
}
</style>
