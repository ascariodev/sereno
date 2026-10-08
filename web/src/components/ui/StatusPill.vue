<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const STATUSES = ['open', 'resolved', 'ignored']

const props = defineProps<{ status: string }>()
const { t, te } = useI18n()

const known = computed(() => STATUSES.includes(props.status))
const label = computed(() => (known.value && te(`notice.status.${props.status}`) ? t(`notice.status.${props.status}`) : props.status))
const tone = computed(() => (known.value ? props.status : 'ignored'))
</script>

<template>
  <span class="status-pill" :class="`status-pill--${tone}`" :data-status="tone">{{ label }}</span>
</template>

<style scoped>
.status-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
  white-space: nowrap;
}
.status-pill--open { background: var(--status-open-bg); color: var(--status-open-fg); }
.status-pill--resolved { background: var(--status-resolved-bg); color: var(--status-resolved-fg); }
.status-pill--ignored { background: var(--status-ignored-bg); color: var(--status-ignored-fg); }
</style>
