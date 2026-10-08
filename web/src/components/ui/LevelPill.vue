<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { LOG_LEVELS, levelTone } from '../../api/logLevels'

const props = defineProps<{ level: string }>()
const { t, te } = useI18n()

const known = computed(() => LOG_LEVELS.includes(props.level))
const label = computed(() => (known.value && te(`notice.level.${props.level}`) ? t(`notice.level.${props.level}`) : props.level))
const tone = computed(() => levelTone(props.level))
</script>

<template>
  <span class="level-pill" :class="`level-pill--${tone}`" :data-level="tone">{{ label }}</span>
</template>

<style scoped>
.level-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
  white-space: nowrap;
}
.level-pill--debug { background: var(--level-debug-bg); color: var(--level-debug-fg); }
.level-pill--info { background: var(--level-info-bg); color: var(--level-info-fg); }
.level-pill--notice { background: var(--level-notice-bg); color: var(--level-notice-fg); }
.level-pill--warning { background: var(--level-warning-bg); color: var(--level-warning-fg); }
.level-pill--error { background: var(--level-error-bg); color: var(--level-error-fg); }
.level-pill--critical { background: var(--level-critical-bg); color: var(--level-critical-fg); }
.level-pill--alert { background: var(--level-alert-bg); color: var(--level-alert-fg); }
.level-pill--emergency { background: var(--level-emergency-bg); color: var(--level-emergency-fg); }
</style>
