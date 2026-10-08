<script lang="ts">
const PALETTE = [
  { bg: '#DCD9FB', fg: '#2B2E91' },
  { bg: '#FCE3D3', fg: '#93370D' },
  { bg: '#D3F0E3', fg: '#05603A' },
]

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters =
    words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[words.length - 1]][0]]
  return letters.join('').toLocaleUpperCase()
}

export function paletteFor(id: number | string): { bg: string; fg: string } {
  const n = Math.abs(Number(id))
  const index = Number.isFinite(n)
    ? Math.floor(n)
    : [...String(id)].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return PALETTE[index % PALETTE.length]
}
</script>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; id: number | string; size?: number }>(), { size: 32 })

const initials = computed(() => initialsOf(props.name))
const colors = computed(() => paletteFor(props.id))
const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  background: colors.value.bg,
  color: colors.value.fg,
  fontSize: `${Math.round(props.size * 0.375)}px`,
}))
</script>

<template>
  <span class="app-avatar" :style="style" aria-hidden="true">{{ initials }}</span>
</template>

<style scoped>
.app-avatar {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  border-radius: var(--radius-pill);
  font-weight: 600;
  line-height: 1;
  user-select: none;
}
</style>
