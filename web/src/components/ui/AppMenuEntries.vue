<script setup lang="ts">
import { Check, ChevronRight } from '@lucide/vue'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from 'reka-ui'
import type { AppMenuItem } from './AppMenu.vue'

defineProps<{ items: AppMenuItem[] }>()

const emit = defineEmits<{ select: [value: string] }>()
</script>

<template>
  <template v-for="item in items" :key="item.value">
    <DropdownMenuSub v-if="item.children">
      <DropdownMenuSubTrigger class="app-menu__item" :disabled="item.disabled" :text-value="item.label" :data-value="item.value">
        <component :is="item.icon" v-if="item.icon" class="app-menu__icon" :size="16" aria-hidden="true" />
        <span class="app-menu__label">{{ item.label }}</span>
        <span v-if="item.hint" class="app-menu__hint">{{ item.hint }}</span>
        <ChevronRight class="app-menu__icon" :size="15" aria-hidden="true" />
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent class="app-menu" :side-offset="6" :collision-padding="8">
          <AppMenuEntries :items="item.children" @select="emit('select', $event)" />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
    <component
      :is="item.checked === undefined ? DropdownMenuItem : DropdownMenuCheckboxItem"
      v-else
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
  </template>
</template>
