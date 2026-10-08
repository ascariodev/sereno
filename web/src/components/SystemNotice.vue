<script setup lang="ts">
import { Check, EyeOff, Info, OctagonAlert, RotateCcw, TriangleAlert } from '@lucide/vue'
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { statusFrom, updateLogGroupStatus } from '../api/logGroups'
import { isLogGroupOpenedPayload, isLogGroupStatusChangedPayload } from '../api/types'
import type { LogGroupStatus, Message } from '../api/types'
import { levelTone as toneOf } from '../api/logLevels'
import { hourlyCountsOf, requestHourlyCounts } from '../composables/useHourlyCounts'
import { setGroupStatus, statusOfGroup } from '../composables/useLogGroupStatuses'
import LevelPill from './ui/LevelPill.vue'
import Sparkline from './ui/Sparkline.vue'

const STRONG_LEVELS = ['critical', 'alert', 'emergency']
const STATUSES = ['open', 'resolved', 'ignored']

const props = defineProps<{ message: Message; projectId?: number }>()
const emit = defineEmits<{ select: [groupId: number] }>()

const { t, te, locale } = useI18n()

const kindId = useId()
const pending = ref(false)
const errorText = ref<string | null>(null)

const payload = computed(() => props.message.payload)
const opened = computed(() => (isLogGroupOpenedPayload(payload.value) ? payload.value : null))
const changed = computed(() => (isLogGroupStatusChangedPayload(payload.value) ? payload.value : null))
const groupId = computed(() => opened.value?.log_group_id ?? null)
const sharedStatus = computed(() => statusOfGroup(groupId.value))
const doneStatus = computed(() => (sharedStatus.value && sharedStatus.value !== 'open' ? sharedStatus.value : null))
const canAct = computed(() => props.projectId !== undefined && groupId.value !== null)
const hourly = computed(() => (props.projectId === undefined ? null : hourlyCountsOf(groupId.value)))

watch(
  () => [props.projectId, groupId.value, props.message.id] as const,
  ([projectId, id, messageId]) => {
    if (projectId !== undefined && id !== null) requestHourlyCounts(projectId, id, messageId)
  },
  { immediate: true },
)

async function act(status: LogGroupStatus): Promise<void> {
  if (pending.value || !canAct.value) return
  pending.value = true
  errorText.value = null
  try {
    const response = await updateLogGroupStatus(props.projectId as number, groupId.value as number, status)
    setGroupStatus(groupId.value as number, statusFrom(response) ?? status)
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 403) {
      errorText.value = t('notice.actions.forbidden')
    } else if (caught instanceof ApiError && caught.status === 422) {
      errorText.value = caught.errors?.status?.[0] ?? caught.message
    } else {
      errorText.value = t('notice.actions.failed')
    }
  } finally {
    pending.value = false
  }
}

function known(prefix: string, value: string): string {
  return te(`${prefix}.${value}`) ? t(`${prefix}.${value}`) : value
}

const levelTone = computed(() => toneOf(opened.value?.level))
const strong = computed(() => STRONG_LEVELS.includes(levelTone.value))
const levelIcon = computed(() => {
  if (opened.value?.type === 'log.group_reopened') return RotateCcw
  if (strong.value) return OctagonAlert
  return ['warning', 'error'].includes(levelTone.value) ? TriangleAlert : Info
})
const kindLabel = computed(() =>
  opened.value?.type === 'log.group_reopened' ? t('notice.reopenedLabel') : t('notice.openedLabel'),
)
const eventsWord = computed(() => (opened.value ? t('notice.eventsWord', opened.value.events_count) : ''))

const changedTone = computed(() => (changed.value && STATUSES.includes(changed.value.status) ? changed.value.status : 'ignored'))
const actor = computed(() => props.message.user?.name ?? t('notice.unknownActor'))
const changedStatus = computed(() => (changed.value ? known('notice.status', changed.value.status) : ''))
const changedTitle = computed(() => changed.value?.title?.trim() || null)

const created = computed(() => new Date(props.message.created_at))
const shortTime = computed(() => created.value.toLocaleTimeString(locale.value, { timeStyle: 'short' }))
const fullDate = computed(() => created.value.toLocaleString(locale.value, { dateStyle: 'full', timeStyle: 'medium' }))
</script>

<template>
  <div v-if="opened" class="system-notice" :class="{ 'system-notice--strong': strong }" :data-level="levelTone">
    <span class="system-notice__icon" :class="`system-notice__icon--${levelTone}`" aria-hidden="true">
      <component :is="levelIcon" :size="17" :stroke-width="1.8" />
    </span>
    <article class="system-notice__card" :aria-labelledby="kindId">
      <div class="system-notice__head">
        <LevelPill :level="opened.level" />
        <span :id="kindId" class="system-notice__kind">{{ kindLabel }}</span>
        <time class="system-notice__time" :datetime="message.created_at" :title="fullDate">{{ shortTime }}</time>
      </div>
      <p class="system-notice__title">
        <a :href="`?group=${opened.log_group_id}`" @click.prevent="emit('select', opened.log_group_id)">{{ opened.title }}</a>
      </p>
      <div class="system-notice__activity">
        <p class="system-notice__stats">
          <b>{{ opened.events_count }}</b> {{ eventsWord }}
        </p>
        <Sparkline v-if="hourly" :counts="hourly" :level="levelTone" />
      </div>
      <p v-if="doneStatus" class="system-notice__done">
        {{ t('notice.actions.marked', { status: known('notice.status', doneStatus) }) }}
      </p>
      <div v-else-if="canAct" class="system-notice__actions">
        <button type="button" name="resolve" class="system-notice__primary" :disabled="pending" @click="act('resolved')">
          <Check :size="15" :stroke-width="2" aria-hidden="true" />
          {{ t('notice.actions.resolve') }}
        </button>
        <button type="button" name="ignore" class="system-notice__secondary" :disabled="pending" @click="act('ignored')">
          <EyeOff :size="15" :stroke-width="1.8" aria-hidden="true" />
          {{ t('notice.actions.ignore') }}
        </button>
      </div>
      <p v-if="errorText" role="alert" class="system-notice__error">{{ errorText }}</p>
    </article>
  </div>
  <div v-else-if="changed" class="system-notice-line">
    <span class="system-notice-line__icon" :class="`system-notice-line__icon--${changedTone}`" aria-hidden="true">
      <Check v-if="changedTone === 'resolved'" :size="13" :stroke-width="2.4" />
      <EyeOff v-else-if="changedTone === 'ignored'" :size="13" :stroke-width="2.4" />
      <RotateCcw v-else :size="13" :stroke-width="2.4" />
    </span>
    <i18n-t :keypath="changedTitle ? 'notice.statusChangedTitled' : 'notice.statusChanged'" tag="span" scope="global">
      <template #actor>
        <b class="system-notice-line__actor">{{ actor }}</b>
      </template>
      <template v-if="changedTitle" #title>
        <em class="system-notice-line__title">{{ changedTitle }}</em>
      </template>
      <template #status>
        <b :class="`system-notice-line__status--${changedTone}`">{{ changedStatus }}</b>
      </template>
    </i18n-t>
    <time class="system-notice-line__time" :datetime="message.created_at" :title="fullDate">{{ shortTime }}</time>
  </div>
  <p v-else class="system-notice-generic">{{ t('channel.systemNotice') }}</p>
</template>

<style scoped>
.system-notice {
  display: flex;
  gap: var(--space-3);
}
.system-notice__icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 10px;
}
.system-notice__icon--debug { background: var(--level-debug-bg); color: var(--level-debug-fg); }
.system-notice__icon--info { background: var(--level-info-bg); color: var(--level-info-fg); }
.system-notice__icon--notice { background: var(--level-notice-bg); color: var(--level-notice-fg); }
.system-notice__icon--warning { background: var(--level-warning-bg); color: var(--level-warning-fg); }
.system-notice__icon--error { background: var(--level-error-bg); color: var(--level-error-fg); }
.system-notice__icon--critical { background: var(--level-critical-bg); color: var(--level-critical-fg); }
.system-notice__icon--alert { background: var(--level-alert-bg); color: var(--level-alert-fg); }
.system-notice__icon--emergency { background: var(--level-emergency-bg); color: var(--level-emergency-fg); }
.system-notice__card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
}
.system-notice--strong .system-notice__card {
  border-color: color-mix(in srgb, var(--level-critical-bg) 35%, var(--border));
}
.system-notice__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.system-notice__kind {
  font-size: 13px;
  color: var(--ink-2);
}
.system-notice__time {
  margin-left: auto;
  font-size: 12px;
  color: var(--ink-3);
}
.system-notice__title {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.system-notice__title a {
  color: inherit;
  text-decoration: none;
}
.system-notice__title a:hover {
  text-decoration: underline;
}
.system-notice__activity {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.system-notice__stats {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-2);
}
.system-notice__stats b {
  font-weight: 600;
  color: var(--ink);
}
.system-notice__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.system-notice__actions button {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 var(--space-3);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.system-notice__actions button:disabled {
  opacity: 0.6;
  cursor: default;
}
.system-notice__primary {
  border: 0;
  background: var(--ink);
  color: var(--surface);
}
.system-notice__secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink);
}
.system-notice__done {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-2);
}
.system-notice__error {
  margin: 0;
  font-size: 12.5px;
  color: var(--level-error-fg);
}
.system-notice-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding-left: 46px;
  font-size: 13px;
  color: var(--ink-2);
  overflow-wrap: anywhere;
}
.system-notice-line__icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-pill);
}
.system-notice-line__icon--open { background: var(--status-open-bg); color: var(--status-open-fg); }
.system-notice-line__icon--resolved { background: var(--status-resolved-bg); color: var(--status-resolved-fg); }
.system-notice-line__icon--ignored { background: var(--status-ignored-bg); color: var(--status-ignored-fg); }
.system-notice-line b {
  font-weight: 600;
}
.system-notice-line__actor {
  color: var(--ink);
}
.system-notice-line__title {
  color: var(--ink);
}
.system-notice-line__status--open { color: var(--status-open-fg); }
.system-notice-line__status--resolved { color: var(--status-resolved-fg); }
.system-notice-line__status--ignored { color: var(--status-ignored-fg); }
.system-notice-line__time {
  font-size: 12px;
  color: var(--ink-3);
}
.system-notice-generic {
  margin: 0;
  color: var(--ink-3);
  overflow-wrap: anywhere;
}
</style>
