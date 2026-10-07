<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message } from '../api/types'

type Payload = NonNullable<Message['payload']>
type GroupPayload = Extract<Payload, { events_count: number }>
type StatusPayload = Extract<Payload, { previous_status: string }>

const props = defineProps<{ message: Message }>()

const { t, te } = useI18n()

function known(prefix: string, value: string): string {
  return te(`${prefix}.${value}`) ? t(`${prefix}.${value}`) : value
}

const text = computed(() => {
  const payload = props.message.payload
  switch (payload?.type) {
    case 'log.group_opened':
    case 'log.group_reopened': {
      const group = payload as GroupPayload
      return t(group.type === 'log.group_opened' ? 'notice.groupOpened' : 'notice.groupReopened', {
        level: known('notice.level', group.level),
        title: group.title,
        events: t('notice.events', { count: group.events_count }, group.events_count),
      })
    }
    case 'log.group_status_changed':
      return t('notice.statusChanged', {
        actor: props.message.user?.name ?? t('notice.unknownActor'),
        status: known('notice.status', (payload as StatusPayload).status),
      })
    default:
      return t('channel.systemNotice')
  }
})
</script>

<template>
  <p class="system-notice">{{ text }}</p>
</template>

<style scoped>
.system-notice {
  margin: 0;
  opacity: 0.7;
  font-style: italic;
  overflow-wrap: anywhere;
}
</style>
