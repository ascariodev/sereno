import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { api } from '../api/client'
import type { Channel, Paginated, Project } from '../api/types'
import { useOrganizationStore } from './organization'

const PER_PAGE = 100

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

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([])
  const channelByProject = ref<Record<number, number>>({})
  const loading = ref(false)
  const failed = ref(false)
  let generation = 0

  function clear(): void {
    generation++
    projects.value = []
    channelByProject.value = {}
    failed.value = false
    loading.value = false
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

  const organization = useOrganizationStore()
  watch(
    () => organization.activeId,
    (id) => (id === null ? clear() : reload()),
    { immediate: true },
  )

  return { projects, channelByProject, loading, failed, reload, clear }
})
