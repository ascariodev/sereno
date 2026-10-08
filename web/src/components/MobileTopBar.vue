<script setup lang="ts">
import { Menu } from '@lucide/vue'
import { useI18n } from 'vue-i18n'

defineProps<{ open: boolean }>()
defineEmits<{ toggle: [] }>()

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
    <strong class="mobile-top-bar__brand">{{ t('app.name') }}</strong>
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

.mobile-top-bar__button:hover {
  color: var(--ink);
}

.mobile-top-bar__button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.mobile-top-bar__brand {
  font-size: 17px;
}

@media (max-width: 767px) {
  .mobile-top-bar {
    display: flex;
  }
}
</style>
