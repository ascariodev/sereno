<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary'
    size?: 'lg' | 'md' | 'sm'
  }>(),
  { variant: 'primary', size: 'lg' },
)
</script>

<template>
  <button :class="['app-button', `app-button--${variant}`, `app-button--${size}`]"><slot /></button>
</template>

<style scoped>
.app-button {
  border: 1px solid transparent;
  border-radius: 10px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.app-button--primary {
  background: var(--ink);
  color: var(--surface);
}
.app-button--secondary {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--ink);
}
.app-button--lg {
  min-height: 46px;
  font-size: 15px;
}
.app-button--md {
  min-height: 44px;
  padding: 0 16px;
}
.app-button--sm {
  min-height: 32px;
  padding: 0 10px;
  font-size: 13px;
}
.app-button:disabled {
  opacity: 0.6;
  cursor: default;
}
.app-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
