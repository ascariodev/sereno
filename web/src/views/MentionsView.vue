<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Mention } from '../api/types'
import MessageBody from '../components/MessageBody.vue'
import { useAuthStore } from '../stores/auth'
import { useMentionsStore } from '../stores/mentions'

const { t, locale } = useI18n()
const store = useMentionsStore()
const auth = useAuthStore()

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

function when(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.trunc(seconds / size), unit)
  }
  return formatter.format(0, 'second')
}

function target(mention: Mention) {
  return {
    name: 'channel',
    params: { id: mention.channel.id },
    query: mention.parent_id === null ? {} : { thread: String(mention.parent_id) },
  }
}

function title(mention: Mention): string {
  const name = mention.message.user?.name ?? t('mentions.someone')
  return t('mentions.from', { name, channel: mention.channel.name })
}

const initial = (mention: Mention) => (mention.message.user?.name ?? '?').trim().charAt(0).toUpperCase()
const hasUnread = computed(() => store.unreadCount > 0)

function open(mention: Mention): void {
  void store.markRead(mention)
}

onMounted(() => {
  if (!store.loaded || store.error !== null) void store.refresh()
})
</script>

<template>
  <section class="mentions" aria-labelledby="mentions-title">
    <header class="mentions__header">
      <h1 id="mentions-title" class="mentions__title">{{ t('mentions.title') }}</h1>
      <button
        v-if="store.loaded && hasUnread"
        type="button"
        name="mark-all-read"
        class="mentions__action"
        @click="store.markAllRead()"
      >
        {{ t('mentions.markAllRead') }}
      </button>
    </header>

    <p v-if="!store.loaded && store.error === null" class="mentions__note">{{ t('common.loading') }}</p>
    <p v-else-if="!store.loaded" class="mentions__note" role="alert">
      {{ t('mentions.loadFailed') }}
      <button type="button" name="retry" class="mentions__action" @click="store.refresh()">{{ t('common.retry') }}</button>
    </p>
    <p v-else-if="store.mentions.length === 0" class="mentions__note">{{ t('mentions.empty') }}</p>
    <template v-else>
      <ul class="mentions__list">
        <li v-for="mention in store.mentions" :key="mention.id" class="mentions__item">
          <RouterLink
            :to="target(mention)"
            class="mention"
            :class="{ 'mention--unread': mention.read_at === null }"
            :aria-labelledby="`mention-${mention.id}-title`"
            :aria-describedby="`mention-${mention.id}-body`"
            @click="open(mention)"
          >
            <span class="mention__avatar" aria-hidden="true">{{ initial(mention) }}</span>
            <span class="mention__main">
              <span :id="`mention-${mention.id}-title`" class="mention__title">
                <span v-if="mention.read_at === null" class="sr-only">{{ t('mentions.unread') }}, </span>
                {{ title(mention) }}
              </span>
              <span :id="`mention-${mention.id}-body`" class="mention__body">
                <MessageBody :body="mention.message.body" :mentions="mention.message.mentions" :own-user-id="auth.user?.id" />
              </span>
            </span>
            <span v-if="mention.read_at === null" class="mention__dot" aria-hidden="true" />
            <time class="mention__when" :datetime="mention.created_at">{{ when(mention.created_at) }}</time>
          </RouterLink>
        </li>
      </ul>
      <p v-if="store.loadMoreFailed" class="mentions__note" role="alert">{{ t('mentions.loadMoreFailed') }}</p>
      <button
        v-if="store.nextCursor !== null"
        type="button"
        name="load-more"
        class="mentions__action"
        :disabled="store.loadingMore"
        @click="store.loadMore()"
      >
        {{ store.loadingMore ? t('common.loading') : store.loadMoreFailed ? t('common.retry') : t('mentions.loadMore') }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.mentions {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 760px;
}

.mentions__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.mentions__title {
  margin: 0;
  font-size: 20px;
}

.mentions__note {
  margin: 0;
  color: var(--ink-3);
}

.mentions__action {
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

.mentions__action:hover:not(:disabled) {
  color: var(--ink);
}

.mentions__action:focus-visible,
.mention:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.mentions__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  overflow: hidden;
}

.mentions__item + .mentions__item {
  border-top: 1px solid var(--border);
}

.mention {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  padding: 14px 16px;
  color: var(--ink);
  text-decoration: none;
}

.mention--unread {
  background: var(--accent-soft);
}

.mention__avatar {
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

.mention__main {
  display: flex;
  flex: 1 1 280px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mention__title {
  font-weight: 600;
}

.mention__body {
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

.mention__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--accent);
}

.mention__when {
  min-width: 80px;
  color: var(--ink-3);
  font-size: 12.5px;
  text-align: right;
}
</style>
