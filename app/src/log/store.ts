import { create } from 'zustand'

import { api, ApiError } from '@/api/client'
import type { LogGroupTask } from '@/messages/logGroups'
import { isLogGroupStatus, type LogGroupStatus } from '@/messages/payload'

export const LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'] as const
export const STATUS_FILTERS = ['open', 'resolved', 'ignored', 'all'] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]
export type LevelFilter = 'all' | (typeof LOG_LEVELS)[number]

export interface LogEvent {
  id: number
  level: string
  message: string
  context: Record<string, unknown> | unknown[] | null
  occurred_at: string
  source?: string | null
}

export interface LogGroup {
  id: number
  project_id: number
  level: string
  title: string
  status: LogGroupStatus
  events_count: number
  first_seen_at: string
  last_seen_at: string
  events?: LogEvent[]
  task?: LogGroupTask | null
}

interface Paginated {
  data: LogGroup[]
  meta: { current_page: number; last_page: number }
}

export async function getLogGroup(projectId: number, groupId: number): Promise<LogGroup> {
  const response = await api.get<{ data: LogGroup }>(`/api/projects/${projectId}/log-groups/${groupId}`)
  return response.data
}

function fetchPage(projectId: number, status: StatusFilter, level: LevelFilter, page: number): Promise<Paginated> {
  return api.get<Paginated>(`/api/projects/${projectId}/log-groups`, {
    query: {
      status: status === 'all' ? undefined : status,
      level: level === 'all' ? undefined : level,
      page: page > 1 ? page : undefined,
    },
  })
}

function isNotFound(caught: unknown): boolean {
  return caught instanceof ApiError && caught.status === 404
}

function mergeUnique(current: LogGroup[], incoming: LogGroup[]): LogGroup[] {
  const seen = new Set(current.map((group) => group.id))
  return [...current, ...incoming.filter((group) => !seen.has(group.id))]
}

interface LogState {
  projectId: number | null
  groups: LogGroup[]
  status: StatusFilter
  level: LevelFilter
  page: number
  lastPage: number
  loading: boolean
  loadingMore: boolean
  failed: boolean
  notFound: boolean
  everLoaded: boolean
  actionFailed: boolean
  open(projectId: number): Promise<void>
  setFilters(status: StatusFilter, level: LevelFilter): Promise<void>
  loadMore(): Promise<void>
  refresh(): Promise<void>
  applyStatus(groupId: number, status: LogGroupStatus): void
  setTask(groupId: number, task: LogGroupTask): void
  clear(): void
}

const initial = {
  projectId: null,
  groups: [] as LogGroup[],
  status: 'open' as StatusFilter,
  level: 'all' as LevelFilter,
  page: 1,
  lastPage: 1,
  loading: false,
  loadingMore: false,
  failed: false,
  notFound: false,
  everLoaded: false,
  actionFailed: false,
}

let generation = 0
let refreshing: number | null = null

export const useLogStore = create<LogState>()((set, get) => ({
  ...initial,

  async open(projectId) {
    generation++
    set({ ...initial, projectId, loading: true })
    await get().refresh()
  },

  async setFilters(status, level) {
    const { projectId, status: previousStatus, level: previousLevel, everLoaded } = get()
    if (projectId === null) return
    const current = ++generation
    set({ status, level, loading: true, loadingMore: false, failed: false, notFound: false, actionFailed: false })
    try {
      const response = await fetchPage(projectId, status, level, 1)
      if (current !== generation) return
      set({
        groups: response.data,
        page: 1,
        lastPage: response.meta.last_page,
        loading: false,
        everLoaded: true,
      })
    } catch (caught) {
      if (current !== generation) return
      if (isNotFound(caught)) set({ groups: [], loading: false, notFound: true })
      else if (everLoaded) set({ status: previousStatus, level: previousLevel, loading: false, actionFailed: true })
      else set({ loading: false, failed: true })
    }
  },

  async loadMore() {
    const { projectId, status, level, page, lastPage, loading, loadingMore } = get()
    if (projectId === null || loading || loadingMore || refreshing !== null || page >= lastPage) return
    const current = ++generation
    set({ loadingMore: true, actionFailed: false })
    try {
      const response = await fetchPage(projectId, status, level, page + 1)
      if (current !== generation) return
      set((state) => ({
        groups: mergeUnique(state.groups, response.data),
        page: page + 1,
        lastPage: response.meta.last_page,
        loadingMore: false,
      }))
    } catch {
      if (current !== generation) return
      set({ loadingMore: false, actionFailed: true })
    }
  },

  async refresh() {
    const { projectId, status, level, page, everLoaded } = get()
    if (projectId === null) return
    const current = ++generation
    refreshing = current
    if (!everLoaded) set({ loading: true, failed: false, notFound: false })
    try {
      let groups: LogGroup[] = []
      let lastPage = 1
      let reached = 1
      for (let next = 1; next <= Math.max(page, 1); next++) {
        const response = await fetchPage(projectId, status, level, next)
        if (current !== generation) return
        groups = mergeUnique(groups, response.data)
        lastPage = response.meta.last_page
        reached = next
        if (next >= lastPage) break
      }
      set({ groups, page: reached, lastPage, loading: false, loadingMore: false, failed: false, everLoaded: true })
    } catch (caught) {
      if (current !== generation) return
      if (isNotFound(caught)) set({ groups: [], loading: false, loadingMore: false, notFound: true })
      else if (everLoaded) set({ loading: false, loadingMore: false })
      else set({ loading: false, failed: true })
    } finally {
      if (refreshing === current) refreshing = null
    }
  },

  applyStatus(groupId, status) {
    if (!isLogGroupStatus(status)) return
    set((state) => ({
      groups: state.groups.flatMap((group) => {
        if (group.id !== groupId) return [group]
        return state.status === 'all' || state.status === status ? [{ ...group, status }] : []
      }),
    }))
  },

  setTask(groupId, task) {
    set((state) => ({
      groups: state.groups.map((group) => (group.id === groupId ? { ...group, task } : group)),
    }))
  },

  clear() {
    generation++
    set({ ...initial })
  },
}))
