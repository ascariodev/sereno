<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ApiError } from '../api/client'
import { listLogSources, revokeLogSource, rotateLogSourceKey } from '../api/logSources'
import type { LogSource, LogSourceConnectedEvent, LogSourceWithKey } from '../api/types'
import CreateLogSourceDialog from '../components/CreateLogSourceDialog.vue'
import LogSourceKeyDialog from '../components/LogSourceKeyDialog.vue'
import ProjectHeader from '../components/ProjectHeader.vue'
import AppDialog from '../components/ui/AppDialog.vue'
import { toast } from '../components/ui/toast'
import { onReconnect, subscribeToProject } from '../realtime/echo'
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
const projectMissing = computed(() => validId.value && !project.value && projects.loaded)

const sources = ref<LogSource[]>([])
const createOpen = ref(false)
const issuedSource = ref<LogSourceWithKey | null>(null)
const shownSource = computed<LogSourceWithKey | null>({
  get: () => {
    const issued = issuedSource.value
    if (!issued) return null
    const listed = sources.value.find((item) => item.id === issued.id)
    return listed ? { ...issued, last_used_at: listed.last_used_at } : issued
  },
  set: (value) => {
    issuedSource.value = value
  },
})
const pending = ref<{ kind: 'rotate' | 'revoke'; source: LogSource } | null>(null)
const busy = ref(false)
const loading = ref(false)
const failed = ref(false)
let generation = 0
let tick = 0
const touchedAt = new Map<number, number>()
let controller: AbortController | null = null

const confirmOpen = computed({
  get: () => pending.value !== null,
  set: (open: boolean) => {
    if (!open && !busy.value) pending.value = null
  },
})

function formatDate(value: string): string {
  return new Date(value).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
}

function touch(id: number): void {
  touchedAt.set(id, ++tick)
}

function reset(): void {
  generation++
  touchedAt.clear()
  controller?.abort()
  sources.value = []
  createOpen.value = false
  issuedSource.value = null
  pending.value = null
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

function withoutKey(issued: LogSourceWithKey): LogSource {
  const listed: Partial<LogSourceWithKey> = { ...issued }
  delete listed.key
  return listed as LogSource
}

function onCreated(created: LogSourceWithKey): void {
  const listed = withoutKey(created)
  touch(listed.id)
  sources.value = [...sources.value.filter((item) => item.id !== listed.id), listed]
  issuedSource.value = created
}

function replaceSource(updated: LogSource): void {
  touch(updated.id)
  sources.value = sources.value.map((item) => (item.id === updated.id ? updated : item))
}

function unavailableKey(kind: 'rotate' | 'revoke', error: ApiError): string {
  if (kind === 'revoke') return 'integrations.revokeUnavailable'
  if (error.errors.project) return 'integrations.rotateProjectArchived'
  if (error.errors.source) return 'integrations.rotateSourceRevoked'
  return 'integrations.rotateUnavailable'
}

async function confirmAction(): Promise<void> {
  const action = pending.value
  if (!action || busy.value) return
  const current = generation
  busy.value = true
  try {
    if (action.kind === 'rotate') {
      const rotated = await rotateLogSourceKey(projectId.value, action.source.id)
      if (current !== generation) return
      replaceSource(withoutKey(rotated))
      issuedSource.value = rotated
    } else {
      const revoked = await revokeLogSource(projectId.value, action.source.id)
      if (current !== generation) return
      replaceSource(revoked)
      toast.success(t('integrations.revokedToast', { name: action.source.name }))
    }
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 409) {
      toast.error(t(action.kind === 'rotate' ? 'integrations.rotateConflict' : 'integrations.revokeConflict'))
      void load()
    } else if (error.status === 422) {
      toast.error(t(unavailableKey(action.kind, error)))
      void load()
    } else if (error.status === 403) {
      toast.error(t('integrations.actionForbidden'))
    } else {
      toast.error(t('integrations.actionFailed'))
    }
  } finally {
    busy.value = false
    if (current === generation) pending.value = null
  }
}

async function refresh(): Promise<void> {
  const current = generation
  const launchedAt = tick
  try {
    const result = await listLogSources(projectId.value)
    if (current !== generation) return
    const changedSince = (id: number) => (touchedAt.get(id) ?? 0) > launchedAt
    const local = new Map(sources.value.map((item) => [item.id, item]))
    const merged = result.map((item) => (changedSince(item.id) ? (local.get(item.id) ?? item) : item))
    const listed = new Set(result.map((item) => item.id))
    sources.value = [...merged, ...sources.value.filter((item) => !listed.has(item.id) && changedSince(item.id))]
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
  }
}

function applyConnected(event: LogSourceConnectedEvent): void {
  touch(event.id)
  sources.value = sources.value.map((item) =>
    item.id === event.id ? { ...item, last_used_at: event.last_used_at } : item,
  )
}

let unsubscribe: (() => void) | null = null
let unsubscribeReconnect: (() => void) | null = null

function leaveRealtime(): void {
  unsubscribe?.()
  unsubscribeReconnect?.()
  unsubscribe = unsubscribeReconnect = null
}

function joinRealtime(): void {
  leaveRealtime()
  if (!organization.canManageLogSources || !validId.value || organization.activeId === null) return
  unsubscribe = subscribeToProject(organization.activeId, projectId.value, { onLogSourceConnected: applyConnected })
  unsubscribeReconnect = onReconnect(() => void refresh())
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

watch(
  () => `${organization.activeId}:${projectId.value}:${organization.canManageLogSources}`,
  joinRealtime,
  { immediate: true },
)

onUnmounted(() => {
  leaveRealtime()
  reset()
})
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
          <button type="button" class="integrations__create" data-test="create" :disabled="loading" @click="createOpen = true">
            {{ t('integrations.create') }}
          </button>
        </div>
        <p v-if="loading || (!project && !projects.failed && !projects.loaded)" data-test="loading">{{ t('common.loading') }}</p>
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
            <div v-if="!source.revoked_at && project && !project.archived_at" class="integrations__actions">
              <button
                type="button"
                class="integrations__action"
                data-test="rotate"
                :aria-label="`${t('integrations.rotate')} ${source.name}`"
                @click="pending = { kind: 'rotate', source }"
              >
                {{ t('integrations.rotate') }}
              </button>
              <button
                type="button"
                class="integrations__action integrations__action--danger"
                data-test="revoke"
                :aria-label="`${t('integrations.revoke')} ${source.name}`"
                @click="pending = { kind: 'revoke', source }"
              >
                {{ t('integrations.revoke') }}
              </button>
            </div>
          </li>
        </ul>
      </template>
    </div>
    <CreateLogSourceDialog v-model:open="createOpen" :project-id="projectId" @created="onCreated" />
    <LogSourceKeyDialog v-model:source="shownSource" />
    <AppDialog
      v-model:open="confirmOpen"
      :title="pending?.kind === 'rotate' ? t('integrations.rotateTitle') : t('integrations.revokeTitle')"
      :close-label="t('integrations.cancel')"
    >
      <p v-if="pending" data-test="confirm-text">
        {{
          pending.kind === 'rotate'
            ? t('integrations.rotateConfirm', { name: pending.source.name })
            : t('integrations.revokeConfirm', { name: pending.source.name })
        }}
      </p>
      <div class="integrations__confirm-actions">
        <button type="button" class="integrations__action" data-test="cancel" :disabled="busy" @click="pending = null">
          {{ t('integrations.cancel') }}
        </button>
        <button
          type="button"
          class="integrations__action integrations__action--danger"
          data-test="confirm"
          :disabled="busy"
          @click="confirmAction"
        >
          {{ busy ? t('integrations.working') : pending?.kind === 'rotate' ? t('integrations.rotate') : t('integrations.revoke') }}
        </button>
      </div>
    </AppDialog>
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

.integrations__create:disabled {
  opacity: 0.6;
  cursor: default;
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

.integrations__actions,
.integrations__confirm-actions {
  display: flex;
  gap: 8px;
}

.integrations__confirm-actions {
  justify-content: flex-end;
  margin-top: 16px;
}

.integrations__action {
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.integrations__action--danger {
  color: var(--level-error-fg);
}

.integrations__confirm-actions .integrations__action--danger {
  border-color: var(--level-error-fg);
  background: var(--level-error-bg);
}

.integrations__action:disabled {
  opacity: 0.6;
  cursor: default;
}

.integrations__action:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@media (max-width: 600px) {
  .integrations__body {
    padding: 24px 16px;
  }
}
</style>
