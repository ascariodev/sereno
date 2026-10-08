<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { LOG_LEVELS } from '../../api/logLevels'

const WIDTH = 96
const HEIGHT = 24
const PAD = 2

const props = defineProps<{ counts: number[]; level?: string }>()
const { t } = useI18n()

const total = computed(() => props.counts.reduce((sum, value) => sum + value, 0))
const tone = computed(() => (props.level && LOG_LEVELS.includes(props.level) ? props.level : 'debug'))

const points = computed(() => {
  const series = props.counts
  const max = Math.max(0, ...series)
  const step = series.length > 1 ? (WIDTH - PAD * 2) / (series.length - 1) : 0
  return series
    .map((value, index) => {
      const x = PAD + index * step
      const y = max === 0 ? HEIGHT - PAD : HEIGHT - PAD - (value / max) * (HEIGHT - PAD * 2)
      return `${+x.toFixed(2)},${+y.toFixed(2)}`
    })
    .join(' ')
})
</script>

<template>
  <span class="sparkline" :class="`sparkline--${tone}`" :data-level="tone" :data-flat="total === 0 ? 'true' : 'false'">
    <svg :width="WIDTH" :height="HEIGHT" :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" aria-hidden="true" focusable="false">
      <polyline v-if="counts.length" :points="points" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
    <span class="sparkline__text">{{ t('sparkline.total', { n: total }, total) }}</span>
  </span>
</template>

<style scoped>
.sparkline {
  display: inline-block;
  flex: none;
  width: 96px;
  height: 24px;
  line-height: 0;
}
.sparkline svg { display: block; }
.sparkline__text {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.sparkline { position: relative; }
.sparkline--debug { color: var(--level-debug-fg); }
.sparkline--info { color: var(--level-info-fg); }
.sparkline--notice { color: var(--level-notice-fg); }
.sparkline--warning { color: var(--level-warning-fg); }
.sparkline--error { color: var(--level-error-fg); }
.sparkline--critical { color: var(--level-critical-bg); }
.sparkline--alert { color: var(--level-alert-bg); }
.sparkline--emergency { color: var(--level-emergency-bg); }
</style>
