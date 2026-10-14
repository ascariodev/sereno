import { create } from 'zustand'

import { api, ApiError } from '@/api/client'
import { useOrganizationStore } from '@/organization/store'

export interface Project {
  id: number
  name: string
  key: string
  description: string | null
  archived_at: string | null
  open_groups_count?: number
  open_max_level?: string | null
}

export interface ProjectInput {
  name: string
  key: string
  description: string | null
}

interface Channel {
  id: number
  project_id: number
}

interface ProjectsState {
  projects: Project[]
  channelByProject: Record<number, number>
  loading: boolean
  failed: boolean
  loaded: boolean
  load(keepCurrent?: boolean): Promise<void>
  create(input: ProjectInput): Promise<Project>
  update(projectId: number, input: Partial<ProjectInput>): Promise<Project>
  archive(projectId: number): Promise<void>
  clear(): void
}

const PER_PAGE = 100

let generation = 0

async function fetchProjects(): Promise<Project[]> {
  const all: Project[] = []
  let page = 1
  let lastPage = 1
  do {
    const response = await api.get<{ data: Project[]; meta: { last_page: number } }>('/api/projects', {
      query: { per_page: PER_PAGE, page },
    })
    all.push(...response.data)
    lastPage = response.meta.last_page
    page++
  } while (page <= lastPage)
  return all
}

async function fetchChannels(): Promise<Channel[]> {
  const all: Channel[] = []
  let cursor: string | null = null
  do {
    const page: { data: Channel[]; meta?: { next_cursor: string | null } } = await api.get('/api/channels', {
      query: { cursor },
    })
    all.push(...page.data)
    cursor = page.meta?.next_cursor ?? null
  } while (cursor !== null)
  return all
}

export const useProjectsStore = create<ProjectsState>()((set, get) => ({
  projects: [],
  channelByProject: {},
  loading: false,
  failed: false,
  loaded: false,

  async load(keepCurrent = false) {
    const mine = ++generation
    if (keepCurrent) set({ failed: false, loading: true })
    else set({ projects: [], channelByProject: {}, loaded: false, failed: false, loading: true })
    try {
      const [projects, channels] = await Promise.all([fetchProjects(), fetchChannels()])
      if (mine !== generation) return
      set({
        projects: projects.filter((project) => project.archived_at === null),
        channelByProject: Object.fromEntries(channels.map((channel) => [channel.project_id, channel.id])),
        loaded: true,
        loading: false,
      })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (mine === generation) set({ failed: true, loading: false })
    }
  },

  async create(input) {
    const response = await api.post<{ data: Project }>('/api/projects', input)
    await get().load(true)
    return response.data
  },

  async update(projectId, input) {
    const response = await api.patch<{ data: Project }>(`/api/projects/${projectId}`, input)
    set({
      projects: get().projects.map((project) => (project.id === projectId ? { ...project, ...response.data } : project)),
    })
    return response.data
  },

  async archive(projectId) {
    await api.post(`/api/projects/${projectId}/archive`)
    const { [projectId]: _removed, ...channels } = get().channelByProject
    set({ projects: get().projects.filter((project) => project.id !== projectId), channelByProject: channels })
  },

  clear() {
    generation++
    set({ projects: [], channelByProject: {}, loading: false, failed: false, loaded: false })
  },
}))

let lastOrganizationId = useOrganizationStore.getState().activeId
useOrganizationStore.subscribe((state) => {
  if (state.activeId === lastOrganizationId) return
  lastOrganizationId = state.activeId
  const projects = useProjectsStore.getState()
  if (state.activeId === null) projects.clear()
  else void projects.load()
})
