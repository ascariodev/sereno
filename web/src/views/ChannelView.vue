<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { api } from '../api/client'
import type { Channel } from '../api/types'
import MessageList from '../components/MessageList.vue'
import { useMessagesStore } from '../stores/messages'
import { useOrganizationStore } from '../stores/organization'

const { t } = useI18n()
const route = useRoute()
const organization = useOrganizationStore()
const messages = useMessagesStore()
const channel = ref<Channel | null>(null)
let generation = 0

const channelId = computed(() => Number(route.params.id))
const notFound = computed(() => messages.error?.status === 404)
const firstLoadFailed = computed(() => messages.error !== null && !notFound.value && messages.messages.length === 0)

async function loadChannel(id: number, current: number): Promise<void> {
  try {
    const response = await api.get<{ data: Channel[] }>('/api/channels')
    if (current !== generation) return
    channel.value = response.data.find((item) => item.id === id) ?? null
  } catch {
    if (current === generation) channel.value = null
  }
}

function reload(): void {
  const current = ++generation
  channel.value = null
  if (!Number.isInteger(channelId.value) || channelId.value < 1) {
    messages.clear()
    return
  }
  void loadChannel(channelId.value, current)
  void messages.open(channelId.value)
}

watch(() => [organization.activeId, route.params.id], reload, { immediate: true })

onUnmounted(() => {
  generation++
  messages.clear()
})
</script>

<template>
  <section class="channel">
    <h1 v-if="channel">
      {{ channel.name }}
      <small class="channel__project">{{ channel.project.name }}</small>
    </h1>
    <h1 v-else>{{ t('channel.title') }}</h1>
    <p v-if="notFound" role="alert">{{ t('channel.notFound') }}</p>
    <p v-else-if="messages.loading">{{ t('organization.loading') }}</p>
    <p v-else-if="firstLoadFailed" role="alert">
      {{ t('channel.loadFailed') }}
      <button type="button" name="retry" @click="reload">{{ t('organization.retry') }}</button>
    </p>
    <template v-else>
      <p v-if="messages.error" role="alert">{{ t('channel.loadFailed') }}</p>
      <MessageList
        :messages="messages.messages"
        :has-more="messages.nextCursor !== null"
        :loading-more="messages.loadingMore"
        @load-older="messages.loadOlder()"
      />
    </template>
  </section>
</template>

<style scoped>
.channel__project {
  margin-left: 0.5rem;
  opacity: 0.6;
  font-weight: normal;
}
</style>
