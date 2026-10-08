<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api/client'
import { isLogGroupStatusChangedPayload } from '../api/types'
import type { Channel } from '../api/types'
import LogGroupPanel from '../components/LogGroupPanel.vue'
import MessageComposer from '../components/MessageComposer.vue'
import MessageList from '../components/MessageList.vue'
import ProjectHeader from '../components/ProjectHeader.vue'
import { onReconnect, subscribeToChannel } from '../realtime/echo'
import { useMessagesStore } from '../stores/messages'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const organization = useOrganizationStore()
const messages = useMessagesStore()
const projects = useProjectsStore()
const channel = ref<Channel | null>(null)
const channelLoadFailed = ref(false)
const panelRefresh = ref(0)
let seenMessageId = 0
let generation = 0
let unsubscribe: (() => void) | null = null
let unsubscribeReconnect: (() => void) | null = null

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
const notFound = computed(() => messages.error?.status === 404)
const firstLoadFailed = computed(() => messages.error !== null && !notFound.value && messages.messages.length === 0)

async function loadChannel(id: number, current: number): Promise<void> {
  try {
    const response = await api.get<{ data: Channel[] }>('/api/channels', { query: { include_archived: 1 } })
    if (current !== generation) return
    channel.value = response.data.find((item) => item.id === id) ?? null
  } catch {
    if (current === generation) {
      channel.value = null
      channelLoadFailed.value = true
    }
  }
}

function selectGroup(id: number | null): void {
  const query = { ...route.query }
  if (id === null) delete query.group
  else query.group = String(id)
  void router.push({ query })
}

function markMessagesSeen(): void {
  seenMessageId = messages.messages.reduce((max, message) => Math.max(max, message.id), 0)
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
  if (!Number.isInteger(channelId.value) || channelId.value < 1) {
    messages.clear()
    return
  }
  void loadChannel(channelId.value, current)
  void messages.open(channelId.value)
  if (organization.activeId !== null) {
    unsubscribe = subscribeToChannel(organization.activeId, channelId.value, messages.insert)
    unsubscribeReconnect = onReconnect(() => void messages.catchUp())
  }
}

watch(() => [organization.activeId, route.params.id], reload, { immediate: true })

onUnmounted(() => {
  generation++
  leaveRealtime()
  messages.clear()
})
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
            @load-older="messages.loadOlder()"
            @select="selectGroup"
          />
          <p v-if="channel?.archived_at" class="channel__archived">{{ t('channel.archived') }}</p>
          <MessageComposer v-else-if="channel" />
        </template>
      </div>
      <LogGroupPanel
        v-if="channel && groupId !== null"
        class="channel__panel"
        :project-id="channel.project_id"
        :group-id="groupId"
        :refresh-token="panelRefresh"
        @close="selectGroup(null)"
      />
    </div>
  </section>
</template>

<style scoped>
.channel__layout {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}
.channel__main {
  flex: 999 1 420px;
  min-width: 0;
}
.channel__panel {
  flex: 1 1 320px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
}
.channel__title {
  margin: 0;
  padding: 12px 20px;
  font-size: 17px;
}
</style>
