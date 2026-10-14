<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import type { AppNotification } from '../api/types'
import { useSharedNow } from '../composables/useSharedNow'
import { notificationBody as body, notificationTitle as title } from '../notificationText'
import { useNotificationsStore } from '../stores/notifications'

const { t, locale } = useI18n()
const store = useNotificationsStore()
const now = useSharedNow()

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

function when(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now.value) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.trunc(seconds / size), unit)
  }
  return formatter.format(0, 'second')
}

function target(notification: AppNotification): RouteLocationRaw | null {
  switch (notification.type) {
    case 'task_assigned':
    case 'task_comment_mention':
    case 'task_commented':
      if (notification.project_id === null) return null
      return {
        name: 'project-plan',
        params: { projectId: notification.project_id },
        query: { task: String(notification.data.task_id) },
      }
    case 'chat_mention':
      return {
        name: 'channel',
        params: { id: notification.data.channel_id },
        query:
          notification.data.parent_id === null
            ? { message: String(notification.data.message_id) }
            : { thread: String(notification.data.parent_id) },
      }
    default:
      return null
  }
}

function actorName(notification: AppNotification): string | null {
  return notification.type === 'unknown' ? null : notification.data.actor_name
}

const initial = (notification: AppNotification) => (actorName(notification) ?? '?').trim().charAt(0).toUpperCase() || '?'
const hasUnread = computed(() => store.unreadCount > 0)

function open(notification: AppNotification): void {
  void store.markRead(notification)
}

function openAux(event: MouseEvent, notification: AppNotification): void {
  if (event.button === 1) open(notification)
}

onMounted(() => {
  if (!store.loaded || store.error !== null) void store.refresh()
})
</script>

<template>
  <section class="notifications" aria-labelledby="notifications-title">
    <header class="notifications__header">
      <h1 id="notifications-title" class="notifications__title">{{ t('notifications.title') }}</h1>
      <button
        v-if="store.loaded && hasUnread"
        type="button"
        name="mark-all-read"
        class="notifications__action"
        @click="store.markAllRead()"
      >
        {{ t('notifications.markAllRead') }}
      </button>
    </header>

    <p v-if="!store.loaded && store.error === null" class="notifications__note">{{ t('common.loading') }}</p>
    <p v-else-if="!store.loaded" class="notifications__note" role="alert">
      {{ t('notifications.loadFailed') }}
      <button type="button" name="retry" class="notifications__action" @click="store.refresh()">{{ t('common.retry') }}</button>
    </p>
    <p v-else-if="store.notifications.length === 0" class="notifications__note">{{ t('notifications.empty') }}</p>
    <template v-else>
      <p v-if="store.error !== null" class="notifications__note" role="alert">
        {{ t('notifications.loadFailed') }}
        <button type="button" name="retry" class="notifications__action" @click="store.refresh()">{{ t('common.retry') }}</button>
      </p>
      <ul class="notifications__list">
        <li v-for="notification in store.notifications" :key="notification.id" class="notifications__item">
          <component
            :is="target(notification) === null ? 'button' : RouterLink"
            v-bind="target(notification) === null ? { type: 'button' } : { to: target(notification) }"
            class="notification"
            :class="{ 'notification--unread': notification.read_at === null }"
            :aria-labelledby="`notification-${notification.id}-title`"
            :aria-describedby="body(notification) !== null ? `notification-${notification.id}-body` : undefined"
            @click="open(notification)"
            @auxclick="openAux($event, notification)"
          >
            <span class="notification__avatar" aria-hidden="true">{{ initial(notification) }}</span>
            <span class="notification__main">
              <span :id="`notification-${notification.id}-title`" class="notification__title">
                <span v-if="notification.read_at === null" class="sr-only">{{ t('notifications.unread') }}, </span>
                {{ title(notification) }}
              </span>
              <span v-if="body(notification) !== null" :id="`notification-${notification.id}-body`" class="notification__body">
                {{ body(notification) }}
              </span>
            </span>
            <span v-if="notification.read_at === null" class="notification__dot" aria-hidden="true" />
            <time class="notification__when" :datetime="notification.created_at">{{ when(notification.created_at) }}</time>
          </component>
        </li>
      </ul>
      <p v-if="store.loadMoreFailed" class="notifications__note" role="alert">{{ t('notifications.loadMoreFailed') }}</p>
      <button
        v-if="store.nextCursor !== null"
        type="button"
        name="load-more"
        class="notifications__action"
        :disabled="store.loadingMore"
        @click="store.loadMore()"
      >
        {{ store.loadingMore ? t('common.loading') : store.loadMoreFailed ? t('common.retry') : t('notifications.loadMore') }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.notifications {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 760px;
}

.notifications__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.notifications__title {
  margin: 0;
  font-size: 20px;
}

.notifications__note {
  margin: 0;
  color: var(--ink-3);
}

.notifications__action {
  align-self: flex-start;
  min-height: 32px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  cursor: pointer;
}

.notifications__action:hover:not(:disabled) {
  color: var(--ink);
}

.notifications__action:focus-visible,
.notification:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.notifications__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  overflow: hidden;
}

.notifications__item + .notifications__item {
  border-top: 1px solid var(--border);
}

.notification {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  gap: 8px 14px;
  padding: 14px 16px;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  text-align: left;
  text-decoration: none;
}

button.notification {
  cursor: pointer;
}

.notification--unread {
  background: var(--accent-soft);
}

.notification__avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: 11px;
  font-weight: 700;
}

.notification__main {
  display: flex;
  flex: 1 1 280px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.notification__title {
  font-weight: 600;
}

.notification__body {
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

.notification__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--accent);
}

.notification__when {
  min-width: 80px;
  color: var(--ink-3);
  font-size: 12.5px;
  text-align: right;
}
</style>
