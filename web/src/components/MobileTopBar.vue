<script setup lang="ts">
import { Menu, Search } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import BrandMark from './ui/BrandMark.vue'

defineProps<{ open: boolean }>()
defineEmits<{ toggle: []; search: [] }>()

const { t } = useI18n()
</script>

<template>
  <header class="mobile-top-bar">
    <button
      type="button"
      name="open-sidebar"
      class="mobile-top-bar__button"
      :aria-label="t('sidebar.open')"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="$emit('toggle')"
    >
      <Menu :size="20" aria-hidden="true" />
    </button>
    <strong class="mobile-top-bar__brand">
      <BrandMark :size="24" />
      {{ t('app.name') }}
    </strong>
    <button
      type="button"
      name="search"
      class="mobile-top-bar__button mobile-top-bar__search"
      :aria-label="t('command.open')"
      aria-haspopup="dialog"
      @click="$emit('search')"
    >
      <Search :size="20" aria-hidden="true" />
    </button>
  </header>
</template>

<style scoped>
.mobile-top-bar {
  display: none;
  align-items: center;
  gap: 6px;
  padding: calc(14px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) 10px
    calc(12px + env(safe-area-inset-left));
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.mobile-top-bar__button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}

.mobile-top-bar__search {
  margin-left: auto;
}

.mobile-top-bar__button:hover {
  color: var(--ink);
}

.mobile-top-bar__button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.mobile-top-bar__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
}

@media (max-width: 767px) {
  .mobile-top-bar {
    display: flex;
  }
}
</style>
