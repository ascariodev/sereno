<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 28 })
</script>

<template>
  <svg class="brand-mark" :width="size" :height="size" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <rect width="64" height="64" rx="15" fill="#4B4FD8" />
    <path
      d="M17 15h30a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6H29l-9 7v-7h-3a6 6 0 0 1-6-6V21a6 6 0 0 1 6-6z"
      fill="none"
      stroke="#FFFFFF"
      stroke-width="4"
      stroke-linejoin="round"
    />
    <polyline
      points="18,30 24,30 28,23 33,38 37,27 40,30 46,30"
      fill="none"
      stroke="#FFFFFF"
      stroke-width="3.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.brand-mark {
  display: block;
  flex: none;
}
</style>
