<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { updateLogGroupStatus } from '../api/logGroups'
import type { LogGroupStatus, Message } from '../api/types'

type Payload = NonNullable<Message['payload']>
type GroupPayload = Extract<Payload, { events_count: number }>
type StatusPayload = Extract<Payload, { previous_status: string }>

const props = defineProps<{ message: Message; projectId?: number }>()

const { t, te } = useI18n()

const pending = ref(false)
const errorText = ref<string | null>(null)

const payload = computed(() => props.message.payload)
const groupId = computed(() => {
  const value = (payload.value as { log_group_id?: unknown } | null)?.log_group_id ?? props.message.log_group_id
  return typeof value === 'number' ? value : null
})
const canAct = computed(
  () =>
    (payload.value?.type === 'log.group_opened' || payload.value?.type === 'log.group_reopened') &&
    props.projectId !== undefined &&
    groupId.value !== null,
)

async function act(status: LogGroupStatus): Promise<void> {
  if (pending.value || !canAct.value) return
  pending.value = true
  errorText.value = null
  try {
    await updateLogGroupStatus(props.projectId as number, groupId.value as number, status)
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

const text = computed(() => {
  switch (payload.value?.type) {
    case 'log.group_opened':
    case 'log.group_reopened': {
      const group = payload.value as GroupPayload
      return t(group.type === 'log.group_opened' ? 'notice.groupOpened' : 'notice.groupReopened', {
        level: known('notice.level', group.level),
        title: group.title,
        events: t('notice.events', { count: group.events_count }, group.events_count),
      })
    }
    case 'log.group_status_changed':
      return t('notice.statusChanged', {
        actor: props.message.user?.name ?? t('notice.unknownActor'),
        status: known('notice.status', (payload.value as StatusPayload).status),
      })
    default:
      return t('channel.systemNotice')
  }
})
</script>

<template>
  <div>
    <p class="system-notice">{{ text }}</p>
    <p v-if="canAct" class="system-notice__actions">
      <button type="button" name="resolve" :disabled="pending" @click="act('resolved')">
        {{ t('notice.actions.resolve') }}
      </button>
      <button type="button" name="ignore" :disabled="pending" @click="act('ignored')">
        {{ t('notice.actions.ignore') }}
      </button>
    </p>
    <p v-if="errorText" role="alert">{{ errorText }}</p>
  </div>
</template>

<style scoped>
.system-notice {
  margin: 0;
  opacity: 0.7;
  font-style: italic;
  overflow-wrap: anywhere;
}
.system-notice__actions {
  display: flex;
  gap: 0.5rem;
  margin: 0.25rem 0 0;
}
</style>
