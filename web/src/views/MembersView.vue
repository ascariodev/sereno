<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { listMembers } from '../api/members'
import type { Member } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'

const { t, locale } = useI18n()
const organization = useOrganizationStore()
const auth = useAuthStore()

const members = ref<Member[]>([])
const loading = ref(false)
const failed = ref(false)
let generation = 0
let controller: AbortController | null = null

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleDateString(locale.value, { dateStyle: 'medium' })
}

async function load(): Promise<void> {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  members.value = []
  failed.value = false
  loading.value = true
  try {
    const result = await listMembers(controller.signal)
    if (current !== generation) return
    members.value = result
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    failed.value = true
  } finally {
    if (current === generation) loading.value = false
  }
}

watch(
  () => organization.activeId,
  (activeId) => {
    if (activeId !== null) {
      void load()
      return
    }
    generation++
    controller?.abort()
    members.value = []
    loading.value = false
    failed.value = false
  },
  { immediate: true },
)

onUnmounted(() => {
  generation++
  controller?.abort()
})
</script>

<template>
  <section class="members">
    <header class="members__header">
      <h1 class="members__title">{{ t('members.title') }}</h1>
    </header>
    <p v-if="loading" data-test="loading">{{ t('common.loading') }}</p>
    <p v-else-if="failed" role="alert" data-test="load-failed">
      {{ t('members.loadFailed') }}
      <button type="button" name="retry" @click="load">{{ t('common.retry') }}</button>
    </p>
    <p v-else-if="members.length === 0" class="members__empty" data-test="empty">
      {{ t('members.empty') }}
    </p>
    <ul v-else class="members__list">
      <li v-for="member in members" :key="member.id" class="members__item" data-test="member">
        <div class="members__main">
          <strong class="members__name">
            <span data-test="name">{{ member.name }}</span>
            <span v-if="member.id === auth.user?.id" class="members__you" data-test="you">{{ t('members.you') }}</span>
          </strong>
          <span class="members__email" data-test="email">{{ member.email }}</span>
        </div>
        <dl class="members__details">
          <div>
            <dt>{{ t('members.role') }}</dt>
            <dd data-test="role">{{ member.role ? t(`invite.roles.${member.role}`) : t('members.noRole') }}</dd>
          </div>
          <div>
            <dt>{{ t('members.joined') }}</dt>
            <dd data-test="joined">{{ formatDate(member.joined_at) }}</dd>
          </div>
        </dl>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.members {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 760px;
  margin: 0 auto;
  padding: 44px 32px 40px;
}

.members p {
  margin: 0;
}

.members__header {
  margin-bottom: 12px;
}

.members__title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.members__empty {
  padding: 40px 16px;
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-panel);
  color: var(--ink-3);
  text-align: center;
}

.members__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.members__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

.members__main {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.members__name {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-wrap: anywhere;
}

.members__you {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--border);
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
}

.members__email {
  overflow-wrap: anywhere;
  color: var(--ink-3);
  font-size: 13px;
}

.members__details {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  font-size: 13px;
}

.members__details div {
  display: flex;
  gap: 8px;
}

.members__details dt {
  color: var(--ink-3);
}

.members__details dd {
  margin: 0;
  color: var(--ink-2);
}

@media (max-width: 600px) {
  .members {
    padding: 24px 16px;
  }
}
</style>
