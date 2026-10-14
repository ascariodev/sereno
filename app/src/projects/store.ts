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
  load(): Promise<void>
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

export const useProjectsStore = create<ProjectsState>()((set) => ({
  projects: [],
  channelByProject: {},
  loading: false,
  failed: false,
  loaded: false,

  async load() {
    const mine = ++generation
    set({ projects: [], channelByProject: {}, loaded: false, failed: false, loading: true })
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
