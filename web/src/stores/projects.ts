import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { listAllChannels } from '../api/channels'
import { api } from '../api/client'
import { createProject, updateProject, type CreateProjectInput, type UpdateProjectInput } from '../api/projects'
import type { Paginated, Project } from '../api/types'
import { useOrganizationStore } from './organization'

const PER_PAGE = 100
const COUNTS_REFRESH_DELAY_MS = 300

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
  const loaded = ref(false)
  let generation = 0
  let countsGeneration = 0
  let countsTimer: ReturnType<typeof setTimeout> | null = null

  function cancelCountsRefresh(): void {
    countsGeneration++
    if (countsTimer !== null) clearTimeout(countsTimer)
    countsTimer = null
  }

  function clear(): void {
    generation++
    cancelCountsRefresh()
    projects.value = []
    channelByProject.value = {}
    failed.value = false
    loaded.value = false
    loading.value = false
  }

  async function load(keepCurrent: boolean): Promise<void> {
    const current = ++generation
    cancelCountsRefresh()
    if (!keepCurrent) {
      projects.value = []
      channelByProject.value = {}
      loaded.value = false
    }
    failed.value = false
    loading.value = true
    try {
      const [loadedProjects, channels] = await Promise.all([
        fetchProjects(),
        listAllChannels(),
      ])
      if (current !== generation) return
      projects.value = loadedProjects.filter((project) => project.archived_at === null)
      channelByProject.value = Object.fromEntries(channels.map((channel) => [channel.project_id, channel.id]))
      loaded.value = true
    } catch {
      if (current !== generation) return
      failed.value = true
    } finally {
      if (current === generation) loading.value = false
    }
  }

  function reload(): Promise<void> {
    return load(false)
  }

  function refresh(): Promise<void> {
    return load(true)
  }

  function projectIdOfChannel(channelId: number | null | undefined): number | null {
    if (channelId == null) return null
    const entry = Object.entries(channelByProject.value).find(([, id]) => id === channelId)
    return entry ? Number(entry[0]) : null
  }

  function removeProject(projectId: number): number | undefined {
    const channelId = channelByProject.value[projectId]
    projects.value = projects.value.filter((project) => project.id !== projectId)
    const { [projectId]: _removed, ...rest } = channelByProject.value
    channelByProject.value = rest
    return channelId
  }

  async function create(input: CreateProjectInput): Promise<Project> {
    const created = await createProject(input)
    await load(true)
    return created
  }

  async function update(projectId: number, input: UpdateProjectInput): Promise<Project> {
    const updated = await updateProject(projectId, input)
    projects.value = projects.value.map((project) => (project.id === projectId ? { ...project, ...updated } : project))
    return updated
  }

  async function fetchCounts(): Promise<void> {
    const current = ++countsGeneration
    const listGeneration = generation
    try {
      const loaded = await fetchProjects()
      if (current !== countsGeneration || listGeneration !== generation) return
      const fresh = new Map(loaded.map((project) => [project.id, project]))
      projects.value = projects.value.map((project) => {
        const latest = fresh.get(project.id)
        if (!latest) return project
        if (latest.open_groups_count === project.open_groups_count && latest.open_max_level === project.open_max_level) {
          return project
        }
        return { ...project, open_groups_count: latest.open_groups_count, open_max_level: latest.open_max_level }
      })
    } catch {
      // The counts keep their previous values until the next refresh or reload.
    }
  }

  function refreshCounts(): void {
    if (countsTimer !== null) clearTimeout(countsTimer)
    countsTimer = setTimeout(() => {
      countsTimer = null
      if (loading.value) {
        refreshCounts()
        return
      }
      void fetchCounts()
    }, COUNTS_REFRESH_DELAY_MS)
  }

  const organization = useOrganizationStore()
  watch(
    () => organization.activeId,
    (id) => (id === null ? clear() : reload()),
    { immediate: true },
  )

  return { projects, channelByProject, loading, failed, loaded, reload, refresh, projectIdOfChannel, removeProject, create, update, clear, refreshCounts }
})
