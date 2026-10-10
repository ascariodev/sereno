<script setup lang="ts">
import { Plus } from '@lucide/vue'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import ProjectHeader from '../components/ProjectHeader.vue'
import TaskCard from '../components/TaskCard.vue'
import TaskCreateDialog from '../components/TaskCreateDialog.vue'
import { TASK_STATUSES, type TaskStatus } from '../api/types'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'
import { TASK_FILTERS, useTasksStore, type TaskFilter } from '../stores/tasks'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const organization = useOrganizationStore()
const projects = useProjectsStore()
const tasks = useTasksStore()

const projectId = computed(() => Number(route.params.projectId))
const validId = computed(() => Number.isInteger(projectId.value) && projectId.value > 0)
const project = computed(() => projects.projects.find((item) => item.id === projectId.value) ?? null)
const channelId = computed(() => projects.channelByProject[projectId.value] ?? null)
const loadError = computed<'failed' | 'notFound' | null>(() => {
  if (!validId.value) return 'notFound'
  if (tasks.error === null) return null
  return tasks.error.status === 404 ? 'notFound' : 'failed'
})
const statusKey: Record<TaskStatus, string> = {
  todo: 'todo',
  in_progress: 'inProgress',
  in_review: 'inReview',
  done: 'done',
}
const filterKey: Record<TaskFilter, string> = { all: 'all', mine: 'mine', from_notices: 'fromNotices' }
const activeFilter = computed<TaskFilter>(() => {
  const raw = Array.isArray(route.query.filter) ? route.query.filter[0] : route.query.filter
  return TASK_FILTERS.find((item) => item === raw) ?? 'all'
})
const canCreate = computed(() => project.value !== null && project.value.archived_at === null)
const createOpen = ref(false)
const createStatus = ref<TaskStatus>('todo')
const showLoading = computed(() => validId.value && loadError.value === null && tasks.loading)

function load(): void {
  if (validId.value) void tasks.open(projectId.value)
  else tasks.clear()
}

function openCreate(status: TaskStatus): void {
  createStatus.value = status
  createOpen.value = true
}

function setFilter(value: TaskFilter): void {
  if (value === activeFilter.value) return
  const query = { ...route.query }
  if (value === 'all') delete query.filter
  else query.filter = value
  void router.replace({ query })
}

watch(activeFilter, (value) => (tasks.filter = value), { immediate: true })
watch(projectId, load, { immediate: true })
watch(() => organization.activeId, (_, previous) => previous !== null && load())
watch(projectId, () => (createOpen.value = false))

onUnmounted(() => tasks.clear())
</script>

<template>
  <section class="plan-view">
    <ProjectHeader
      v-if="project"
      :name="project.name"
      :project-key="project.key"
      :description="project.description"
      :project-id="project.id"
      :channel-id="channelId"
    >
      <template v-if="canCreate" #actions>
        <button type="button" class="plan-view__new" name="new-task" @click="openCreate('todo')">
          <Plus :size="15" aria-hidden="true" />
          {{ t('plan.newTask') }}
        </button>
      </template>
    </ProjectHeader>
    <h1 v-else class="plan-view__title">{{ t('plan.title') }}</h1>

    <div class="plan-view__main">
      <p v-if="loadError === 'notFound'" role="alert">{{ t('plan.notFound') }}</p>
      <p v-else-if="loadError === 'failed'" role="alert">
        {{ t('plan.loadFailed') }}
        <button type="button" name="retry" @click="load">{{ t('common.retry') }}</button>
      </p>
      <p v-else-if="showLoading">{{ t('common.loading') }}</p>
      <template v-else>
      <div class="plan-view__filters" role="group" :aria-label="t('plan.filters.label')">
        <button
          v-for="item in TASK_FILTERS"
          :key="item"
          type="button"
          class="plan-view__chip"
          :name="`filter-${item}`"
          :aria-pressed="activeFilter === item"
          @click="setFilter(item)"
        >
          {{ t(`plan.filters.${filterKey[item]}`) }}
        </button>
      </div>
      <div class="plan-view__board" role="group" :aria-label="t('plan.board')">
        <section
          v-for="status in TASK_STATUSES"
          :key="status"
          class="plan-view__column"
          :class="`plan-view__column--${status}`"
          :aria-labelledby="`plan-column-${status}`"
        >
          <header class="plan-view__column-head">
            <span class="plan-view__dot" aria-hidden="true"></span>
            <h2 :id="`plan-column-${status}`">{{ t(`plan.status.${statusKey[status]}`) }}</h2>
            <span class="plan-view__count">{{ tasks.visibleColumns[status].length }}</span>
          </header>
          <p v-if="tasks.visibleColumns[status].length === 0" class="plan-view__empty">{{ t('plan.empty') }}</p>
          <TaskCard v-for="task in tasks.visibleColumns[status]" :key="task.id" :task="task" />
          <button
            v-if="canCreate"
            type="button"
            class="plan-view__add"
            :name="`add-${status}`"
            @click="openCreate(status)"
          >
            <Plus :size="14" aria-hidden="true" />
            {{ t('plan.addTask') }}
            <span class="sr-only">{{ t(`plan.status.${statusKey[status]}`) }}</span>
          </button>
        </section>
      </div>
      </template>
    </div>
    <TaskCreateDialog
      v-if="canCreate"
      v-model:open="createOpen"
      :project-id="projectId"
      :status="createStatus"
    />
  </section>
</template>

<style scoped>
.plan-view {
  min-width: 0;
}
.plan-view__title {
  margin: 0;
  padding: 12px 20px;
  font-size: 17px;
}
.plan-view__main {
  min-width: 0;
  padding: var(--space-5) 28px 28px;
}
.plan-view__filters {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.plan-view__chip {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.plan-view__chip[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-weight: 600;
}
.plan-view__chip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.plan-view__board {
  display: grid;
  grid-template-columns: repeat(4, minmax(240px, 1fr));
  gap: 14px;
  align-items: start;
  overflow-x: auto;
}
.plan-view__column {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border-radius: var(--radius-card);
  background: var(--column-bg);
}
.plan-view__column--todo { --column-dot: var(--column-todo); }
.plan-view__column--in_progress { --column-dot: var(--column-in-progress); }
.plan-view__column--in_review { --column-dot: var(--column-in-review); }
.plan-view__column--done { --column-dot: var(--column-done); }
.plan-view__column-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
}
.plan-view__column-head h2 {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
}
.plan-view__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--column-dot);
}
.plan-view__count {
  font-size: 12.5px;
  color: var(--ink-3);
}
.plan-view__empty {
  margin: 0;
  padding: 8px 4px;
  font-size: 13px;
  color: var(--ink-3);
}
.plan-view__new {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 9px;
  background: var(--ink);
  color: var(--surface);
  font-weight: 500;
  cursor: pointer;
}
.plan-view__add {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
  cursor: pointer;
}
.plan-view__add:hover {
  background: var(--surface);
}
.plan-view__new:focus-visible,
.plan-view__add:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
