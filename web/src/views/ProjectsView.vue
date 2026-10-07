<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import type { Channel, Paginated, Project } from '../api/types'
import { useOrganizationStore } from '../stores/organization'

const PER_PAGE = 100

const { t } = useI18n()
const organization = useOrganizationStore()
const projects = ref<Project[]>([])
const channelByProject = ref<Record<number, number>>({})
const loading = ref(false)
const failed = ref(false)
let generation = 0

async function fetchProjects(): Promise<Project[]> {
  const all: Project[] = []
  let page = 1
  let lastPage = 1
  do {
    const response = await api.get<Paginated<Project>>('/api/projects', { query: { per_page: PER_PAGE, page } })
    all.push(...response.data)
    lastPage = response.meta.last_page
    page++
  } while (page <= lastPage)
  return all
}

async function reload(): Promise<void> {
  const current = ++generation
  projects.value = []
  channelByProject.value = {}
  failed.value = false
  loading.value = true
  try {
    const [loadedProjects, channels] = await Promise.all([
      fetchProjects(),
      api.get<{ data: Channel[] }>('/api/channels'),
    ])
    if (current !== generation) return
    projects.value = loadedProjects.filter((project) => project.archived_at === null)
    channelByProject.value = Object.fromEntries(channels.data.map((channel) => [channel.project_id, channel.id]))
  } catch {
    if (current !== generation) return
    failed.value = true
  } finally {
    if (current === generation) loading.value = false
  }
}

watch(() => organization.activeId, reload, { immediate: true })
</script>

<template>
  <section class="projects">
    <h1>{{ t('projects.title') }}</h1>
    <p v-if="loading">{{ t('projects.loading') }}</p>
    <p v-else-if="failed" role="alert">
      {{ t('projects.loadFailed') }}
      <button type="button" name="retry" @click="reload">{{ t('projects.retry') }}</button>
    </p>
    <p v-else-if="projects.length === 0" class="projects__empty">{{ t('projects.empty') }}</p>
    <ul v-else class="projects__list">
      <li v-for="project in projects" :key="project.id" class="projects__item">
        <RouterLink
          v-if="channelByProject[project.id]"
          :to="{ name: 'channel', params: { id: channelByProject[project.id] } }"
        >
          {{ project.name }}
        </RouterLink>
        <span v-else>{{ project.name }}</span>
        <small class="projects__key">{{ project.key }}</small>
        <p v-if="project.description" class="projects__description">{{ project.description }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.projects__list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.projects__key {
  margin-left: 0.5rem;
  opacity: 0.6;
}

.projects__description {
  margin: 0.25rem 0 0;
  opacity: 0.8;
}
</style>
