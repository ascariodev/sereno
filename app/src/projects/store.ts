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
  refreshCounts(): void
  clear(): void
}

const PER_PAGE = 100

const COUNTS_REFRESH_DELAY_MS = 300

let generation = 0
let countsGeneration = 0
let countsTimer: ReturnType<typeof setTimeout> | null = null

function cancelCountsRefresh(): void {
  countsGeneration++
  if (countsTimer !== null) clearTimeout(countsTimer)
  countsTimer = null
}
let changeSeq = 0
let loadsInFlight = 0
// Saved while a load is in flight, so its older response does not undo them.
let recentChanges: { seq: number; project?: Project; archivedId?: number }[] = []

function rememberChange(change: { project?: Project; archivedId?: number }): void {
  if (loadsInFlight > 0) recentChanges.push({ seq: ++changeSeq, ...change })
}

function archivedIdsSince(since: number): Set<number> {
  return new Set(
    recentChanges.flatMap((change) => (change.seq > since && change.archivedId !== undefined ? [change.archivedId] : [])),
  )
}

function applyChanges(projects: Project[], since: number): Project[] {
  const changes = recentChanges.filter((change) => change.seq > since)
  const archived = archivedIdsSince(since)
  return projects
    .filter((project) => !archived.has(project.id))
    .map((project) =>
      changes.reduce(
        (merged, change) => (change.project?.id === merged.id ? { ...merged, ...change.project } : merged),
        project,
      ),
    )
}

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

async function fetchCounts(): Promise<void> {
  const current = ++countsGeneration
  const listGeneration = generation
  try {
    const loaded = await fetchProjects()
    if (current !== countsGeneration || listGeneration !== generation) return
    const fresh = new Map(loaded.map((project) => [project.id, project]))
    useProjectsStore.setState((state) => ({
      projects: state.projects.map((project) => {
        const latest = fresh.get(project.id)
        if (!latest) return project
        if (latest.open_groups_count === project.open_groups_count && latest.open_max_level === project.open_max_level) {
          return project
        }
        return { ...project, open_groups_count: latest.open_groups_count, open_max_level: latest.open_max_level }
      }),
    }))
  } catch {
    // The counts keep their previous values until the next refresh or reload.
  }
}

export const useProjectsStore = create<ProjectsState>()((set, get) => ({
  projects: [],
  channelByProject: {},
  loading: false,
  failed: false,
  loaded: false,

  async load(keepCurrent = false) {
    const mine = ++generation
    cancelCountsRefresh()
    if (keepCurrent) set({ failed: false, loading: true })
    else set({ projects: [], channelByProject: {}, loaded: false, failed: false, loading: true })
    const startedAt = changeSeq
    loadsInFlight++
    try {
      const [projects, channels] = await Promise.all([fetchProjects(), fetchChannels()])
      if (mine !== generation) return
      const archivedSince = archivedIdsSince(startedAt)
      set({
        projects: applyChanges(projects.filter((project) => project.archived_at === null), startedAt),
        channelByProject: Object.fromEntries(
          channels.filter((channel) => !archivedSince.has(channel.project_id)).map((channel) => [channel.project_id, channel.id]),
        ),
        loaded: true,
        loading: false,
      })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (mine === generation) set({ failed: true, loading: false })
    } finally {
      if (--loadsInFlight === 0) recentChanges = []
    }
  },

  async create(input) {
    const response = await api.post<{ data: Project }>('/api/projects', input)
    await get().load(true)
    return response.data
  },

  async update(projectId, input) {
    const response = await api.patch<{ data: Project }>(`/api/projects/${projectId}`, input)
    rememberChange({ project: response.data })
    set({
      projects: get().projects.map((project) => (project.id === projectId ? { ...project, ...response.data } : project)),
    })
    return response.data
  },

  async archive(projectId) {
    await api.post(`/api/projects/${projectId}/archive`)
    rememberChange({ archivedId: projectId })
    const { [projectId]: _removed, ...channels } = get().channelByProject
    set({ projects: get().projects.filter((project) => project.id !== projectId), channelByProject: channels })
  },

  refreshCounts() {
    if (countsTimer !== null) clearTimeout(countsTimer)
    countsTimer = setTimeout(() => {
      countsTimer = null
      if (get().loading) {
        get().refreshCounts()
        return
      }
      void fetchCounts()
    }, COUNTS_REFRESH_DELAY_MS)
  },

  clear() {
    generation++
    cancelCountsRefresh()
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
