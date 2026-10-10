<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import ProjectHeader from '../components/ProjectHeader.vue'
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
    </div>
  </section>
</template>

<style scoped>
.plan-view__title {
  margin: 0;
  padding: 12px 20px;
  font-size: 17px;
}
.plan-view__main {
  padding: var(--space-5) 28px 28px;
}
</style>
