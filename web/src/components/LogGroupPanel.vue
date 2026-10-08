<script setup lang="ts">
import { Check, EyeOff, X } from '@lucide/vue'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { getLogGroup, updateLogGroupStatus } from '../api/logGroups'
import { isLogGroupStatus } from '../api/types'
import type { LogGroup, LogGroupStatus } from '../api/types'
import { toast } from './ui/toast'
import LevelPill from './ui/LevelPill.vue'
import StatusPill from './ui/StatusPill.vue'

const props = defineProps<{ projectId: number; groupId: number; refreshToken?: number }>()
defineEmits<{ close: [] }>()

const { t, locale } = useI18n()

const group = ref<LogGroup | null>(null)
const loading = ref(false)
const loadError = ref<'failed' | 'notFound' | null>(null)
const pending = ref(false)
let generation = 0
let controller: AbortController | null = null

async function load(reset: boolean): Promise<void> {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  if (reset) {
    group.value = null
    loading.value = true
  }
  loadError.value = null
  try {
    const loaded = await getLogGroup(props.projectId, props.groupId, controller.signal)
    if (current !== generation) return
    group.value = loaded
  } catch (caught) {
    if (current !== generation) return
    if (reset) group.value = null
    loadError.value = caught instanceof ApiError && caught.status === 404 ? 'notFound' : 'failed'
  } finally {
    if (current === generation) loading.value = false
  }
}

watch(
  () => [props.projectId, props.groupId] as const,
  () => void load(true),
  { immediate: true },
)
watch(
  () => props.refreshToken,
  () => void load(false),
)

onUnmounted(() => {
  generation++
  controller?.abort()
})

function statusFrom(updated: LogGroup | undefined): LogGroupStatus | null {
  return isLogGroupStatus(updated?.status) ? updated.status : null
}

async function act(status: LogGroupStatus): Promise<void> {
  if (pending.value || !group.value) return
  const current = generation
  pending.value = true
  try {
    const response = await updateLogGroupStatus(props.projectId, props.groupId, status)
    const applied = statusFrom(response) ?? status
    if (current === generation && group.value) group.value = { ...group.value, status: applied }
    toast.success(t('notice.actions.marked', { status: t(`notice.status.${applied}`) }))
  } catch (caught) {
    if (current !== generation) return
    if (caught instanceof ApiError && caught.status === 403) {
      toast.error(t('notice.actions.forbidden'))
    } else if (caught instanceof ApiError && caught.status === 422) {
      toast.error(caught.errors?.status?.[0] ?? caught.message)
    } else {
      toast.error(t('notice.actions.failed'))
    }
  } finally {
    pending.value = false
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
}

const latestEvent = computed(() => group.value?.events?.[0] ?? null)
const eventText = computed(() => {
  const event = latestEvent.value
  if (!event) return ''
  const context = event.context
  if (context === null || (Array.isArray(context) ? context.length === 0 : Object.keys(context).length === 0)) {
    return event.message
  }
  const lines = Array.isArray(context)
    ? [JSON.stringify(context, null, 2)]
    : Object.entries(context).map(([key, value]) => `${key}  ${typeof value === 'string' ? value : JSON.stringify(value)}`)
  return `${event.message}\n\n${lines.join('\n')}`
})
</script>

<template>
  <aside class="log-group-panel" tabindex="-1" :aria-label="t('logGroup.label')">
    <div class="log-group-panel__top">
      <span class="log-group-panel__heading">{{ t('logGroup.heading', { id: groupId }) }}</span>
      <button type="button" name="close-group" class="log-group-panel__close" :aria-label="t('logGroup.close')" @click="$emit('close')">
        <X :size="16" :stroke-width="1.8" aria-hidden="true" />
      </button>
    </div>
    <p v-if="loading" role="status">{{ t('common.loading') }}</p>
    <p v-else-if="loadError && !group" role="alert" class="log-group-panel__error">
      {{ loadError === 'notFound' ? t('logGroup.notFound') : t('logGroup.loadFailed') }}
    </p>
    <template v-else-if="group">
      <p v-if="loadError" role="alert" class="log-group-panel__error">{{ t('logGroup.loadFailed') }}</p>
      <div class="log-group-panel__title">
        <div class="log-group-panel__pills">
          <LevelPill :level="group.level" />
          <StatusPill :status="group.status" />
        </div>
        <h2>{{ group.title }}</h2>
      </div>
      <dl class="log-group-panel__stats">
        <div>
          <dt>{{ t('logGroup.events') }}</dt>
          <dd class="log-group-panel__count" data-test="events-count">{{ group.events_count }}</dd>
        </div>
        <div>
          <dt>{{ t('logGroup.firstSeen') }}</dt>
          <dd>{{ formatDate(group.first_seen_at) }}</dd>
        </div>
        <div>
          <dt>{{ t('logGroup.lastSeen') }}</dt>
          <dd>{{ formatDate(group.last_seen_at) }}</dd>
        </div>
      </dl>
      <section class="log-group-panel__event">
        <h3>{{ t('logGroup.lastEvent') }}</h3>
        <pre v-if="latestEvent" data-test="latest-event">{{ eventText }}</pre>
        <p v-else class="log-group-panel__none">{{ t('logGroup.noEvents') }}</p>
      </section>
      <div class="log-group-panel__actions">
        <button
          v-if="group.status !== 'resolved'"
          type="button"
          name="resolve"
          class="log-group-panel__primary"
          :disabled="pending"
          @click="act('resolved')"
        >
          <Check :size="15" :stroke-width="2" aria-hidden="true" />
          {{ t('notice.actions.resolve') }}
        </button>
        <button
          v-if="group.status !== 'ignored'"
          type="button"
          name="ignore"
          class="log-group-panel__secondary"
          :disabled="pending"
          @click="act('ignored')"
        >
          <EyeOff :size="15" :stroke-width="1.8" aria-hidden="true" />
          {{ t('notice.actions.ignore') }}
        </button>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.log-group-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px 20px;
  border-left: 1px solid var(--border);
  background: var(--bg);
  box-sizing: border-box;
  min-width: 0;
}
.log-group-panel:focus {
  outline: none;
}
.log-group-panel__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.log-group-panel__heading {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-3);
}
.log-group-panel__close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}
.log-group-panel__title {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.log-group-panel__pills {
  display: flex;
  gap: 6px;
}
.log-group-panel h2 {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 14.5px;
  font-weight: 500;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.log-group-panel__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}
.log-group-panel__stats > div {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
}
.log-group-panel__stats dt {
  font-size: 11.5px;
  color: var(--ink-3);
}
.log-group-panel__stats dd {
  margin: 0;
  padding-top: 3px;
  font-size: 14px;
  font-weight: 600;
}
.log-group-panel__stats dd.log-group-panel__count {
  padding-top: 0;
  font-size: 18px;
  font-weight: 700;
}
.log-group-panel__event {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.log-group-panel__event h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-3);
}
.log-group-panel__event pre {
  margin: 0;
  padding: 12px;
  border-radius: 10px;
  background: var(--border);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.log-group-panel__none {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-3);
}
.log-group-panel__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
}
.log-group-panel__actions button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 40px;
  border-radius: 9px;
  font-weight: 500;
  cursor: pointer;
}
.log-group-panel__actions button:disabled {
  opacity: 0.6;
  cursor: default;
}
.log-group-panel__primary {
  border: 0;
  background: var(--ink);
  color: var(--surface);
  font-weight: 600;
}
.log-group-panel__secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink);
}
.log-group-panel__error {
  margin: 0;
  font-size: 12.5px;
  color: var(--level-error-fg);
}
</style>
