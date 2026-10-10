<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { getHourlyCounts, listLogGroups } from '../api/logGroups'
import { isLogGroupOpenedPayload, isLogGroupStatusChangedPayload } from '../api/types'
import type { LogGroup, LogGroupStatus, Message, Paginated } from '../api/types'
import LogGroupAside from '../components/LogGroupAside.vue'
import ProjectHeader from '../components/ProjectHeader.vue'
import AppSegmented from '../components/ui/AppSegmented.vue'
import LevelPill from '../components/ui/LevelPill.vue'
import { LOG_LEVELS } from '../api/logLevels'
import Sparkline from '../components/ui/Sparkline.vue'
import StatusPill from '../components/ui/StatusPill.vue'
import { taskOfGroup } from '../composables/useLogGroupStatuses'
import { onReconnect, subscribeToChannel } from '../realtime/echo'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'

const LIVE_RELOAD_DELAY_MS = 300
const STATUSES: LogGroupStatus[] = ['open', 'resolved', 'ignored']
const ALL = 'all'
const DEFAULT_STATUS = 'open'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const organization = useOrganizationStore()
const projects = useProjectsStore()

const result = ref<Paginated<LogGroup> | null>(null)
const loading = ref(false)
const loadError = ref<'failed' | 'notFound' | null>(null)
let generation = 0
let loadedProject: number | null = null
let controller: AbortController | null = null
const hourly = ref<Record<string, number[]>>({})
let hourlyGeneration = 0
let hourlyController: AbortController | null = null

function firstQuery(name: string): string | undefined {
  const raw = route.query[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : undefined
}

function positiveInt(raw: string | undefined): number | null {
  return raw !== undefined && /^[1-9]\d*$/.test(raw) ? Number(raw) : null
}

const projectId = computed(() => Number(route.params.projectId))
const statusFilter = computed(() => {
  const raw = firstQuery('status')
  return raw === ALL || STATUSES.includes(raw as LogGroupStatus) ? (raw as string) : DEFAULT_STATUS
})
const levelFilter = computed(() => {
  const raw = firstQuery('level')
  return raw !== undefined && LOG_LEVELS.includes(raw) ? raw : ALL
})
const page = computed(() => positiveInt(firstQuery('page')) ?? 1)
const groupId = computed(() => positiveInt(firstQuery('group')))

const project = computed(() => projects.projects.find((item) => item.id === projectId.value) ?? null)
const channelId = computed(() => projects.channelByProject[projectId.value] ?? null)
const groups = computed(() => result.value?.data ?? [])
const lastPage = computed(() => result.value?.meta.last_page ?? 1)

const statusOptions = computed(() =>
  [...STATUSES, ALL].map((value) => ({ value, label: t(`log.statusFilter.${value}`) })),
)
const levelOptions = computed(() => [
  { value: ALL, label: t('log.level.all') },
  ...LOG_LEVELS.map((value) => ({ value, label: t('log.level.atLeast', { level: t(`notice.level.${value}`) }) })),
])

function navigate(changes: Record<string, string | undefined>, replace = false): void {
  const query: Record<string, unknown> = { ...route.query, ...changes }
  for (const key of Object.keys(query)) if (query[key] === undefined) delete query[key]
  const target = { query: query as Record<string, string> }
  if (replace) void router.replace(target)
  else void router.push(target)
}

function setStatus(value: string): void {
  navigate({ status: value === DEFAULT_STATUS ? undefined : value, page: undefined })
}

function setLevel(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  navigate({ level: value === ALL ? undefined : value, page: undefined })
}

function goToPage(target: number): void {
  navigate({ page: target <= 1 ? undefined : String(target) })
}

function selectGroup(id: number | null, replace = false): void {
  navigate({ group: id === null ? undefined : String(id) }, replace)
}

function resetHourly(): void {
  hourlyGeneration++
  hourlyController?.abort()
  hourlyController = null
  hourly.value = {}
}

function hourlyFor(group: LogGroup): number[] | undefined {
  return hourly.value[String(group.id)]
}

async function loadHourly(rows: LogGroup[]): Promise<void> {
  const current = ++hourlyGeneration
  hourlyController?.abort()
  hourlyController = null
  if (rows.length === 0) {
    hourly.value = {}
    return
  }
  hourlyController = new AbortController()
  try {
    const response = await getHourlyCounts(projectId.value, rows.map((row) => row.id), hourlyController.signal)
    if (current !== hourlyGeneration) return
    hourly.value = response.counts ?? {}
  } catch {
    if (current === hourlyGeneration) hourly.value = {}
  }
}

async function load(): Promise<void> {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  const { signal } = controller
  if (loadedProject !== projectId.value) {
    result.value = null
    resetHourly()
  }
  loadedProject = projectId.value
  loading.value = true
  loadError.value = null
  if (!Number.isInteger(projectId.value) || projectId.value < 1) {
    result.value = null
    resetHourly()
    loading.value = false
    loadError.value = 'notFound'
    return
  }
  try {
    const response = await listLogGroups(
      projectId.value,
      {
        status: statusFilter.value === ALL ? undefined : (statusFilter.value as LogGroupStatus),
        level: levelFilter.value === ALL ? undefined : levelFilter.value,
        page: page.value,
      },
      signal,
    )
    if (current !== generation) return
    if (page.value > response.meta.last_page && response.meta.last_page >= 1) {
      void router.replace({ query: { ...route.query, page: response.meta.last_page > 1 ? String(response.meta.last_page) : undefined } })
      return
    }
    result.value = response
    void loadHourly(response.data)
  } catch (caught) {
    if (current !== generation) return
    result.value = null
    resetHourly()
    loadError.value = caught instanceof ApiError && caught.status === 404 ? 'notFound' : 'failed'
  } finally {
    if (current === generation) loading.value = false
  }
}

watch(
  () => [projectId.value, statusFilter.value, levelFilter.value, page.value] as const,
  () => void load(),
  { immediate: true },
)

watch(
  () => organization.activeId,
  (_, previous) => {
    const pageWillReset = previous !== null && page.value !== 1
    if (previous !== null && (firstQuery('group') !== undefined || firstQuery('page') !== undefined)) {
      navigate({ group: undefined, page: undefined }, true)
    }
    if (!pageWillReset) void load()
  },
)

let reloadTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribe: (() => void) | null = null
let unsubscribeReconnect: (() => void) | null = null

function scheduleLiveReload(): void {
  if (reloadTimer !== null) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    void load()
  }, LIVE_RELOAD_DELAY_MS)
}

function onLiveMessage(message: Message): void {
  const payload = message.payload
  if (isLogGroupOpenedPayload(payload) || isLogGroupStatusChangedPayload(payload)) projects.refreshCounts()
  if (!isLogGroupStatusChangedPayload(payload)) return
  const row = groups.value.find((item) => item.id === payload.log_group_id)
  if (row?.status === payload.status) return
  scheduleLiveReload()
}

function onPanelStatus(): void {
  void load()
  projects.refreshCounts()
}

function leaveRealtime(): void {
  unsubscribe?.()
  unsubscribe = null
  unsubscribeReconnect?.()
  unsubscribeReconnect = null
  if (reloadTimer !== null) clearTimeout(reloadTimer)
  reloadTimer = null
}

watch(
  () => [organization.activeId, channelId.value] as const,
  ([organizationId, channel]) => {
    leaveRealtime()
    if (organizationId === null || channel === null) return
    unsubscribe = subscribeToChannel(organizationId, channel, { onCreated: onLiveMessage })
    unsubscribeReconnect = onReconnect(() => {
      void load()
      projects.refreshCounts()
    })
  },
  { immediate: true },
)

onUnmounted(() => {
  leaveRealtime()
  generation++
  controller?.abort()
  resetHourly()
})

function taskOf(group: LogGroup) {
  return group.task ?? taskOfGroup(group.id) ?? null
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <section class="log-view">
    <ProjectHeader
      v-if="project"
      :name="project.name"
      :project-key="project.key"
      :description="project.description"
      :project-id="project.id"
      :channel-id="channelId"
    />
    <h1 v-else class="log-view__title">{{ t('log.title') }}</h1>

    <div class="log-view__layout">
      <div class="log-view__main">
        <div class="log-view__filters" role="group" :aria-label="t('log.filters')">
          <AppSegmented
            :model-value="statusFilter"
            :options="statusOptions"
            :label="t('log.statusFilter.label')"
            @update:model-value="setStatus"
          />
          <label class="log-view__level">
            <span class="log-view__level-label">{{ t('log.level.label') }}</span>
            <select name="level" :value="levelFilter" @change="setLevel">
              <option v-for="option in levelOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
        </div>

        <p v-if="loadError === 'notFound'" role="alert">{{ t('log.notFound') }}</p>
        <p v-else-if="loadError === 'failed'" role="alert">
          {{ t('log.loadFailed') }}
          <button type="button" name="retry" @click="load">{{ t('common.retry') }}</button>
        </p>
        <p v-else-if="loading && result === null">{{ t('common.loading') }}</p>
        <template v-else-if="result">
          <p v-if="groups.length === 0" class="log-view__empty">{{ t('log.empty') }}</p>
          <div
            v-else
            class="log-view__scroll"
            role="region"
            tabindex="0"
            :aria-label="t('log.table.label')"
            :aria-busy="loading"
          >
            <table class="log-view__table">
              <thead>
                <tr>
                  <th scope="col" class="log-view__col-level">{{ t('log.table.level') }}</th>
                  <th scope="col">{{ t('log.table.group') }}</th>
                  <th scope="col" class="log-view__col-events">{{ t('log.table.events') }}</th>
                  <th scope="col" class="log-view__col-activity">{{ t('log.table.activity') }}</th>
                  <th scope="col" class="log-view__col-last">{{ t('log.table.lastSeen') }}</th>
                  <th scope="col" class="log-view__col-status">{{ t('log.table.status') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="group in groups" :key="group.id" :data-group="group.id">
                  <td><LevelPill :level="group.level" /></td>
                  <td>
                    <a
                      class="log-view__group"
                      :href="`?group=${group.id}`"
                      :aria-current="group.id === groupId ? 'true' : undefined"
                      @click.prevent="selectGroup(group.id)"
                    >{{ group.title }}</a>
                    <RouterLink
                      v-if="taskOf(group)"
                      class="log-view__task"
                      data-test="group-task-chip"
                      :to="{ name: 'project-plan', params: { projectId }, query: { task: String(taskOf(group)!.id) } }"
                      :aria-label="t('logGroup.viewTask', { key: taskOf(group)!.key })"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 7v7M12 7v4M16 7v9" /></svg>
                      {{ taskOf(group)!.key }}
                    </RouterLink>
                  </td>
                  <td class="log-view__number">{{ group.events_count }}</td>
                  <td class="log-view__activity">
                    <Sparkline v-if="hourlyFor(group)" :counts="hourlyFor(group)!" :level="group.level" />
                  </td>
                  <td class="log-view__date">{{ formatDate(group.last_seen_at) }}</td>
                  <td><StatusPill :status="group.status" /></td>
                </tr>
              </tbody>
            </table>
          </div>

          <nav v-if="lastPage > 1" class="log-view__pagination" :aria-label="t('log.pagination.label')">
            <button type="button" name="prev-page" :disabled="page <= 1" @click="goToPage(page - 1)">
              {{ t('log.pagination.previous') }}
            </button>
            <span>{{ t('log.pagination.page', { page, last: lastPage }) }}</span>
            <button type="button" name="next-page" :disabled="page >= lastPage" @click="goToPage(page + 1)">
              {{ t('log.pagination.next') }}
            </button>
          </nav>
        </template>
      </div>

      <LogGroupAside
        v-if="groupId !== null && !Number.isNaN(projectId)"
        class="log-view__panel"
        :project-id="projectId"
        :group-id="groupId"
        @close="selectGroup(null, $event)"
        @status="onPanelStatus"
      />
    </div>
  </section>
</template>

<style scoped>
.log-view__title {
  margin: 0;
  padding: 12px 20px;
  font-size: 17px;
}
.log-view__layout {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}
.log-view__main {
  flex: 999 1 420px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  padding: var(--space-5) 28px 28px;
}
.log-view__panel {
  flex: 1 1 320px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
}
.log-view__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.log-view__level {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink-3);
  font-size: 13px;
}
.log-view__level select {
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--ink);
}
.log-view__scroll {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
}
.log-view__table {
  width: 100%;
  min-width: 850px;
  border-collapse: collapse;
  font-size: 13.5px;
}
.log-view__table th {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
}
.log-view__table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.log-view__table tbody tr:last-child td {
  border-bottom: 0;
}
.log-view__col-level { width: 110px; }
.log-view__col-events { width: 100px; }
.log-view__col-activity { width: 130px; }
.log-view__col-last { width: 170px; }
.log-view__col-status { width: 110px; }
.log-view__group {
  display: block;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  overflow-wrap: anywhere;
  text-decoration: none;
}
.log-view__task {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--bg);
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
}
.log-view__task:hover {
  color: var(--accent-ink);
}
.log-view__group:hover,
.log-view__group[aria-current='true'] {
  color: var(--accent-ink);
}
.log-view__number {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.log-view__date {
  color: var(--ink-2);
  white-space: nowrap;
}
.log-view__empty {
  margin: 0;
  color: var(--ink-3);
}
.log-view__pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  color: var(--ink-2);
}
.log-view__pagination button {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
  cursor: pointer;
}
.log-view__pagination button:disabled {
  color: var(--ink-3);
  cursor: default;
}
</style>
