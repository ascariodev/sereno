<script setup lang="ts">
import { computed, onBeforeUnmount, onUnmounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api/client'
import { isLogGroupOpenedPayload, isLogGroupStatusChangedPayload } from '../api/types'
import type { Channel, Message, MessageDeletedEvent } from '../api/types'
import { messageActionsKey } from '../components/messageActions'
import LogGroupAside from '../components/LogGroupAside.vue'
import MessageComposer from '../components/MessageComposer.vue'
import MessageList from '../components/MessageList.vue'
import ProjectHeader from '../components/ProjectHeader.vue'
import ThreadAside from '../components/ThreadAside.vue'
import AppDialog from '../components/ui/AppDialog.vue'
import { toast, toasts } from '../components/ui/toast'
import { onReconnect, subscribeToChannel } from '../realtime/echo'
import { useAuthStore } from '../stores/auth'
import { useMessagesStore } from '../stores/messages'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'
import { useThreadStore } from '../stores/thread'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const organization = useOrganizationStore()
const auth = useAuthStore()
const messages = useMessagesStore()
const projects = useProjectsStore()
const thread = useThreadStore()
const channel = ref<Channel | null>(null)
const channelLoadFailed = ref(false)
const panelRefresh = ref(0)
// Prepared state for the delete confirmation and the inline editor (later phases).
const editingMessageId = ref<number | null>(null)
const deletingMessage = ref<Message | null>(null)
provide(messageActionsKey, {
  edit: (message) => {
    editingMessageId.value = message.id
  },
  remove: (message) => {
    deletingMessage.value = message
  },
})
const panelProjectId = ref<number | null>(null)
let seenMessageId = 0
let generation = 0
let unsubscribe: (() => void) | null = null
let unsubscribeReconnect: (() => void) | null = null
let reconnectToastId: number | null = null

const channelId = computed(() => Number(route.params.id))
const project = computed(() => {
  if (!channel.value) return null
  const summary = channel.value.project
  const full = projects.projects.find((item) => item.id === channel.value?.project_id)
  return { name: full?.name ?? summary.name, key: full?.key ?? summary.key, description: full?.description ?? null }
})
const groupId = computed(() => {
  const raw = Array.isArray(route.query.group) ? route.query.group[0] : route.query.group
  return typeof raw === 'string' && /^[1-9]\d*$/.test(raw) ? Number(raw) : null
})
const threadId = computed(() => {
  const raw = Array.isArray(route.query.thread) ? route.query.thread[0] : route.query.thread
  return typeof raw === 'string' && /^[1-9]\d*$/.test(raw) ? Number(raw) : null
})
const notFound = computed(() => messages.error?.status === 404)
const firstLoadFailed = computed(() => messages.error !== null && !notFound.value && messages.messages.length === 0)

async function loadChannel(id: number, current: number): Promise<void> {
  try {
    const response = await api.get<{ data: Channel[] }>('/api/channels', { query: { include_archived: 1 } })
    if (current !== generation) return
    channel.value = response.data.find((item) => item.id === id) ?? null
    if (channel.value) panelProjectId.value = channel.value.project_id
  } catch {
    if (current === generation) {
      channel.value = null
      channelLoadFailed.value = true
    }
  }
}

function selectGroup(id: number | null, replace = false): void {
  const query = { ...route.query }
  if (id === null) delete query.group
  else {
    query.group = String(id)
    delete query.thread
  }
  if (replace) void router.replace({ query })
  else void router.push({ query })
}

function openThread(id: number): void {
  const query = { ...route.query }
  delete query.group
  query.thread = String(id)
  void router.push({ query })
}

function closeThread(): void {
  const query = { ...route.query }
  delete query.thread
  void router.push({ query })
}

const narrowQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 767px)') : null
const narrow = ref(narrowQuery?.matches ?? false)
function followViewport(event: MediaQueryListEvent): void {
  narrow.value = event.matches
}
narrowQuery?.addEventListener('change', followViewport)
onBeforeUnmount(() => narrowQuery?.removeEventListener('change', followViewport))

watch(threadId, (id) => {
  if (id === null) thread.clear()
})

// A hand-written URL with both params keeps the thread; opening one panel always removes the other param.
watch(
  () => [threadId.value, groupId.value],
  ([threadParam, groupParam]) => {
    if (threadParam === null || groupParam === null) return
    const query = { ...route.query }
    delete query.group
    void router.replace({ query })
  },
  { immediate: true },
)

function markMessagesSeen(): void {
  seenMessageId = messages.messages.at(-1)?.id ?? 0
}

watch(
  () => messages.loading,
  (loading) => {
    if (!loading) markMessagesSeen()
  },
  { immediate: true },
)

watch(
  () => messages.messages,
  () => {
    if (messages.loading) return
    const previous = seenMessageId
    markMessagesSeen()
    if (groupId.value === null) return
    const changed = messages.messages.some(
      (message) =>
        message.id > previous &&
        isLogGroupStatusChangedPayload(message.payload) &&
        message.payload.log_group_id === groupId.value,
    )
    if (changed) panelRefresh.value++
  },
)

function onLiveMessage(message: Message): void {
  messages.insert(message)
  thread.insert(message)
  if (isLogGroupOpenedPayload(message.payload) || isLogGroupStatusChangedPayload(message.payload)) {
    projects.refreshCounts()
  }
}

function onLiveUpdated(message: Message): void {
  messages.replace(message)
  thread.replace(message)
}

function onLiveDeleted(event: MessageDeletedEvent): void {
  messages.remove(event)
  thread.remove(event)
}

function leaveRealtime(): void {
  unsubscribe?.()
  unsubscribe = null
  unsubscribeReconnect?.()
  unsubscribeReconnect = null
}

function reload(): void {
  const current = ++generation
  channel.value = null
  channelLoadFailed.value = false
  leaveRealtime()
  thread.clear()
  if (!Number.isInteger(channelId.value) || channelId.value < 1) {
    messages.clear()
    return
  }
  void loadChannel(channelId.value, current)
  void messages.open(channelId.value)
  if (organization.activeId !== null) {
    unsubscribe = subscribeToChannel(organization.activeId, channelId.value, {
      onCreated: onLiveMessage,
      onUpdated: onLiveUpdated,
      onDeleted: onLiveDeleted,
    })
    unsubscribeReconnect = onReconnect(() => {
      const visible = toasts.value.some((item) => item.id === reconnectToastId && item.open)
      if (!visible) reconnectToastId = toast.success(t('channel.reconnected'))
      void messages.catchUp()
      void thread.catchUp()
      projects.refreshCounts()
    })
  }
}

watch(
  () => [organization.activeId, route.params.id],
  () => {
    panelProjectId.value = null
    reload()
  },
  { immediate: true },
)

onUnmounted(() => {
  generation++
  leaveRealtime()
  messages.clear()
  thread.clear()
})

defineExpose({ openThread })
</script>

<template>
  <section class="channel">
    <ProjectHeader
      v-if="channel && project"
      :name="project.name"
      :project-key="project.key"
      :description="project.description"
      :channel-name="channel.name"
      :project-id="channel.project_id"
      :channel-id="channel.id"
    />
    <h1 v-else class="channel__title">{{ t('channel.title') }}</h1>
    <div class="channel__layout">
      <div class="channel__main">
        <p v-if="channelLoadFailed && !notFound" role="status">{{ t('channel.detailsFailed') }}</p>
        <p v-if="notFound" role="alert">{{ t('channel.notFound') }}</p>
        <p v-else-if="messages.loading">{{ t('common.loading') }}</p>
        <p v-else-if="firstLoadFailed" role="alert">
          {{ t('channel.loadFailed') }}
          <button type="button" name="retry" @click="reload">{{ t('common.retry') }}</button>
        </p>
        <template v-else>
          <p v-if="messages.error" role="alert">{{ t('channel.loadFailed') }}</p>
          <MessageList
            :messages="messages.messages"
            :has-more="messages.nextCursor !== null"
            :loading-more="messages.loadingMore"
            :project-id="channel?.project_id"
            :own-user-id="auth.user?.id"
            threadable
            @load-older="messages.loadOlder()"
            @select="selectGroup"
            @open-thread="openThread"
          />
          <p v-if="channel?.archived_at" class="channel__archived">{{ t('channel.archived') }}</p>
          <MessageComposer v-else-if="channel" />
        </template>
      </div>
      <LogGroupAside
        v-if="panelProjectId !== null && groupId !== null && threadId === null"
        class="channel__panel"
        :project-id="panelProjectId"
        :group-id="groupId"
        :refresh-token="panelRefresh"
        @close="selectGroup(null, $event)"
        @status="projects.refreshCounts()"
      />
      <template v-if="channel && threadId !== null">
        <AppDialog v-if="narrow" :open="true" variant="sheet-bottom" :title="t('thread.label')" hide-title @update:open="!$event && closeThread()">
          <ThreadAside
            :channel-id="channel.id"
            :root-id="threadId"
            :archived="channel.archived_at !== null"
            :own-user-id="auth.user?.id"
            @close="closeThread"
          />
        </AppDialog>
        <ThreadAside
          v-else
          class="channel__panel"
          :channel-id="channel.id"
          :root-id="threadId"
          :archived="channel.archived_at !== null"
          :own-user-id="auth.user?.id"
          @close="closeThread"
        />
      </template>
    </div>
  </section>
</template>

<style scoped>
.channel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.channel__layout {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  gap: var(--space-4);
}
.channel__main {
  display: flex;
  flex-direction: column;
  flex: 1 1 420px;
  min-width: 0;
  min-height: 0;
}
.channel__panel {
  flex: 0 0 min(320px, 40%);
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
}
.channel__title {
  margin: 0;
  padding: 12px 20px;
  font-size: 17px;
}
</style>
