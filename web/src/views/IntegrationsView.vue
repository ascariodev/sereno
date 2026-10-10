<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ApiError } from '../api/client'
import { listLogSources } from '../api/logSources'
import type { LogSource } from '../api/types'
import { useOrganizationStore } from '../stores/organization'

const { t, locale } = useI18n()
const route = useRoute()
const organization = useOrganizationStore()

const projectId = computed(() => Number(route.params.projectId))
const validId = computed(() => Number.isInteger(projectId.value) && projectId.value > 0)

const sources = ref<LogSource[]>([])
const loading = ref(false)
const failed = ref(false)
let generation = 0
let controller: AbortController | null = null

function formatDate(value: string): string {
  return new Date(value).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
}

function reset(): void {
  generation++
  controller?.abort()
  sources.value = []
  failed.value = false
  loading.value = false
}

async function load(): Promise<void> {
  reset()
  const current = generation
  controller = new AbortController()
  loading.value = true
  try {
    const result = await listLogSources(projectId.value, controller.signal)
    if (current !== generation) return
    sources.value = result
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    failed.value = true
  } finally {
    if (current === generation) loading.value = false
  }
}

watch(
  () => [organization.activeId, organization.canManageLogSources, projectId.value] as const,
  ([, allowed]) => {
    if (allowed && validId.value) void load()
    else reset()
  },
  { immediate: true },
)

onUnmounted(reset)
</script>

<template>
  <section class="integrations">
    <header class="integrations__header">
      <h1 class="integrations__title">{{ t('integrations.title') }}</h1>
    </header>
    <p v-if="!organization.canManageLogSources" role="alert" data-test="no-permission">
      {{ t('integrations.noPermission') }}
    </p>
    <p v-else-if="!validId" role="alert" data-test="not-found">{{ t('integrations.notFound') }}</p>
    <template v-else>
      <p class="integrations__description">{{ t('integrations.description') }}</p>
      <p v-if="loading" data-test="loading">{{ t('common.loading') }}</p>
      <p v-else-if="failed" role="alert" data-test="load-failed">
        {{ t('integrations.loadFailed') }}
        <button type="button" name="retry" @click="load">{{ t('common.retry') }}</button>
      </p>
      <p v-else-if="sources.length === 0" class="integrations__empty" data-test="empty">
        {{ t('integrations.empty') }}
      </p>
      <ul v-else class="integrations__list">
        <li v-for="source in sources" :key="source.id" class="integrations__item" data-test="source">
          <div class="integrations__main">
            <strong class="integrations__name" data-test="name">{{ source.name }}</strong>
            <code class="integrations__prefix" data-test="prefix">{{ source.key_prefix }}…</code>
          </div>
          <dl class="integrations__details">
            <div>
              <dt>{{ t('integrations.lastUsed') }}</dt>
              <dd data-test="last-used">
                {{ source.last_used_at ? formatDate(source.last_used_at) : t('integrations.neverUsed') }}
              </dd>
            </div>
            <div>
              <dt>{{ t('integrations.created') }}</dt>
              <dd data-test="created">{{ formatDate(source.created_at) }}</dd>
            </div>
            <div v-if="source.revoked_at">
              <dt>{{ t('integrations.revoked') }}</dt>
              <dd data-test="revoked">{{ formatDate(source.revoked_at) }}</dd>
            </div>
          </dl>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.integrations {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 760px;
  margin: 0 auto;
  padding: 44px 32px 40px;
}

.integrations p {
  margin: 0;
}

.integrations__title {
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.integrations__description {
  color: var(--ink-3);
}

.integrations__empty {
  padding: 40px 16px;
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-panel);
  color: var(--ink-3);
  text-align: center;
}

.integrations__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.integrations__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

.integrations__main {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.integrations__name {
  overflow-wrap: anywhere;
}

.integrations__prefix {
  color: var(--ink-3);
  font-size: 13px;
}

.integrations__details {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  font-size: 13px;
}

.integrations__details div {
  display: flex;
  gap: 8px;
}

.integrations__details dt {
  color: var(--ink-3);
}

.integrations__details dd {
  margin: 0;
  color: var(--ink-2);
}

@media (max-width: 600px) {
  .integrations {
    padding: 24px 16px;
  }
}
</style>
