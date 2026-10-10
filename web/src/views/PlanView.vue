<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import ProjectHeader from '../components/ProjectHeader.vue'
import TaskCard from '../components/TaskCard.vue'
import { TASK_STATUSES, type TaskStatus } from '../api/types'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'
import { useTasksStore } from '../stores/tasks'

const { t } = useI18n()
const route = useRoute()
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
const showLoading = computed(() => validId.value && loadError.value === null && tasks.loading)

function load(): void {
  if (validId.value) void tasks.open(projectId.value)
  else tasks.clear()
}

watch(projectId, load, { immediate: true })
watch(() => organization.activeId, (_, previous) => previous !== null && load())

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
    />
    <h1 v-else class="plan-view__title">{{ t('plan.title') }}</h1>

    <div class="plan-view__main">
      <p v-if="loadError === 'notFound'" role="alert">{{ t('plan.notFound') }}</p>
      <p v-else-if="loadError === 'failed'" role="alert">
        {{ t('plan.loadFailed') }}
        <button type="button" name="retry" @click="load">{{ t('common.retry') }}</button>
      </p>
      <p v-else-if="showLoading">{{ t('common.loading') }}</p>
      <div v-else class="plan-view__board" role="group" :aria-label="t('plan.board')">
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
        </section>
      </div>
    </div>
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
</style>
