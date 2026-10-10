<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ApiError } from '../api/client'
import { listLogSources } from '../api/logSources'
import type { LogSource, LogSourceWithKey } from '../api/types'
import CreateLogSourceDialog from '../components/CreateLogSourceDialog.vue'
import LogSourceKeyDialog from '../components/LogSourceKeyDialog.vue'
import ProjectHeader from '../components/ProjectHeader.vue'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'

const { t, locale } = useI18n()
const route = useRoute()
const organization = useOrganizationStore()
const projects = useProjectsStore()

const projectId = computed(() => Number(route.params.projectId))
const validId = computed(() => Number.isInteger(projectId.value) && projectId.value > 0)
const project = computed(() => projects.projects.find((item) => item.id === projectId.value) ?? null)
const channelId = computed(() => projects.channelByProject[projectId.value] ?? null)
const projectMissing = computed(() => validId.value && !project.value && !projects.loading && !projects.failed)

const sources = ref<LogSource[]>([])
const createOpen = ref(false)
const issuedSource = ref<LogSourceWithKey | null>(null)
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
  createOpen.value = false
  issuedSource.value = null
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

function onCreated(created: LogSourceWithKey): void {
  const { key: _key, ...listed } = created
  sources.value = [...sources.value.filter((item) => item.id !== listed.id), listed]
  issuedSource.value = created
}

function retry(): void {
  if (!project.value) void projects.reload()
  else void load()
}

watch(
  () => [organization.activeId, organization.canManageLogSources, projectId.value, project.value !== null] as const,
  ([, allowed, , known]) => {
    if (allowed && validId.value && known) void load()
    else reset()
  },
  { immediate: true },
)

onUnmounted(reset)
</script>

<template>
  <section class="integrations">
    <ProjectHeader
      v-if="project"
      :name="project.name"
      :project-key="project.key"
      :description="project.description"
      :project-id="project.id"
      :channel-id="channelId"
    />
    <div class="integrations__body">
      <h2 class="integrations__title">{{ t('integrations.title') }}</h2>
      <p v-if="!organization.canManageLogSources" role="alert" data-test="no-permission">
        {{ t('integrations.noPermission') }}
      </p>
      <p v-else-if="!validId || projectMissing" role="alert" data-test="not-found">
        {{ t('integrations.notFound') }}
      </p>
      <template v-else>
        <p class="integrations__description">{{ t('integrations.description') }}</p>
        <div v-if="project && !project.archived_at" class="integrations__toolbar">
          <button type="button" class="integrations__create" data-test="create" @click="createOpen = true">
            {{ t('integrations.create') }}
          </button>
        </div>
        <p v-if="loading || (!project && projects.loading)" data-test="loading">{{ t('common.loading') }}</p>
        <p v-else-if="failed || (!project && projects.failed)" role="alert" data-test="load-failed">
          {{ t('integrations.loadFailed') }}
          <button type="button" name="retry" @click="retry">{{ t('common.retry') }}</button>
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
    </div>
    <CreateLogSourceDialog v-model:open="createOpen" :project-id="projectId" @created="onCreated" />
    <LogSourceKeyDialog v-model:source="issuedSource" />
  </section>
</template>

<style scoped>
.integrations__toolbar {
  display: flex;
  justify-content: flex-end;
}

.integrations__create {
  min-height: 44px;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  background: var(--ink);
  color: var(--surface);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.integrations__create:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.integrations__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 32px 40px;
}

.integrations__body p {
  margin: 0;
}

.integrations__title {
  margin: 0 0 12px;
  font-size: 24px;
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
  .integrations__body {
    padding: 24px 16px;
  }
}
</style>
