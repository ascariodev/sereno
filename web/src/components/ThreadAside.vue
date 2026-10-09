<script setup lang="ts">
import { X } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message } from '../api/types'
import { useMessagesStore } from '../stores/messages'
import { useThreadStore } from '../stores/thread'
import MessageComposer from './MessageComposer.vue'
import MessageItem from './MessageItem.vue'
import MessageList from './MessageList.vue'
import SystemNotice from './SystemNotice.vue'

const props = defineProps<{
  channelId: number
  rootId: number
  /** Root message; when omitted it is looked up in the channel store, then in the thread store (from the API). */
  root?: Message | null
  archived?: boolean
  ownUserId?: number
}>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const thread = useThreadStore()
const messages = useMessagesStore()

const rootMessage = computed<Message | null>(
  () =>
    props.root ??
    messages.messages.find((message) => message.id === props.rootId && message.channel_id === props.channelId) ??
    (thread.root?.id === props.rootId && thread.root.channel_id === props.channelId ? thread.root : null),
)
const repliesCount = computed(() => Math.max(rootMessage.value?.replies_count ?? 0, thread.replies.length))
const notFound = computed(() => thread.error?.status === 404)
const panel = ref<HTMLElement | null>(null)

watch(
  () => [props.channelId, props.rootId] as const,
  ([channel, root]) => void thread.open(channel, root),
  { immediate: true },
)

function focusPanel(): void {
  const active = document.activeElement
  const editing = active instanceof HTMLElement && (active.isContentEditable || active.matches('input, textarea, select'))
  if (!editing) panel.value?.focus({ preventScroll: true })
}

onMounted(focusPanel)
watch(() => props.rootId, focusPanel)

function reload(): void {
  void thread.open(props.channelId, props.rootId)
}
</script>

<template>
  <aside ref="panel" class="thread-aside" tabindex="-1" :aria-label="t('thread.label')">
    <div class="thread-aside__top">
      <span class="thread-aside__heading">{{ t('thread.heading') }}</span>
      <button type="button" name="close-thread" class="thread-aside__close" :aria-label="t('thread.close')" @click="emit('close')">
        <X :size="16" :stroke-width="1.8" aria-hidden="true" />
      </button>
    </div>
    <div v-if="rootMessage && !notFound" class="thread-aside__root" data-test="thread-root">
      <SystemNotice v-if="rootMessage.kind === 'system'" :message="rootMessage" />
      <MessageItem v-else :message="rootMessage" :own-user-id="ownUserId" />
    </div>
    <p v-else-if="!rootMessage && !notFound && !thread.loading" class="thread-aside__root-missing" data-test="thread-root-unavailable">
      {{ t('thread.rootUnavailable') }}
    </p>
    <p v-if="notFound" role="alert" class="thread-aside__error">{{ t('thread.notFound') }}</p>
    <template v-else>
      <p class="thread-aside__count" data-test="thread-count">{{ t('thread.replies', { n: repliesCount }, repliesCount) }}</p>
      <p v-if="thread.loading" role="status">{{ t('common.loading') }}</p>
      <p v-else-if="thread.error && thread.replies.length === 0" role="alert" class="thread-aside__error">
        {{ t('thread.loadFailed') }}
        <button type="button" name="retry-thread" @click="reload">{{ t('common.retry') }}</button>
      </p>
      <template v-else>
        <p v-if="thread.error" role="alert" class="thread-aside__error">{{ t('thread.loadFailed') }}</p>
        <MessageList
          class="thread-aside__replies"
          :messages="thread.replies"
          :has-more="thread.nextCursor !== null"
          :loading-more="thread.loadingMore"
          :own-user-id="ownUserId"
          :empty-label="t('thread.noReplies')"
          @load-older="thread.loadOlder()"
        />
        <p v-if="archived" class="thread-aside__archived">{{ t('thread.archived') }}</p>
        <MessageComposer v-else :send="thread.send" :channel-id="channelId" :placeholder="t('thread.replyPlaceholder')"
          :draft="thread.draft"
          @update:draft="thread.setDraft"
        />
      </template>
    </template>
  </aside>
</template>

<style scoped>
.thread-aside {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
  border-left: 1px solid var(--border);
  background: var(--bg);
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
}
.thread-aside:focus {
  outline: none;
}
.thread-aside__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.thread-aside__heading {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-3);
}
.thread-aside__close {
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
.thread-aside__root {
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.thread-aside__root-missing {
  margin: 0;
  font-size: 12px;
  color: var(--ink-3);
}
.thread-aside__count {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-3);
}
.thread-aside__replies {
  flex: 1 1 auto;
}
.thread-aside__error,
.thread-aside__archived {
  margin: 0;
  font-size: 13px;
}
.thread-aside__error {
  color: var(--level-error-fg);
}
</style>
