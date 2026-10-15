import { create } from 'zustand'

import { api, ApiError } from '@/api/client'
import { useMemberDirectoryStore } from '@/projects/members'

export interface ProjectMember {
  id: number
  name: string
  email?: string
  role: string | null
}

export type ActionError = { kind: 'server'; message: string } | { kind: 'addFailed' | 'removeFailed' | 'network' }

export interface Notice {
  kind: 'added' | 'removed'
  name: string
}

interface ProjectMembersState {
  projectId: number | null
  assigned: ProjectMember[]
  organization: ProjectMember[]
  loading: boolean
  failed: boolean
  unavailable: boolean
  busy: boolean
  actionError: ActionError | null
  notice: Notice | null
  open(projectId: number): Promise<void>
  refresh(): Promise<void>
  assign(member: ProjectMember): Promise<void>
  remove(member: ProjectMember): Promise<void>
  clear(): void
}

const initial = {
  projectId: null,
  assigned: [] as ProjectMember[],
  organization: [] as ProjectMember[],
  loading: false,
  failed: false,
  unavailable: false,
  busy: false,
  actionError: null as ActionError | null,
  notice: null as Notice | null,
}

let generation = 0
let tick = 0
const touchedAt = new Map<number, number>()

function touch(id: number): void {
  touchedAt.set(id, ++tick)
}

function mergeFetched(fetched: ProjectMember[], local: ProjectMember[], launchedAt: number): ProjectMember[] {
  const changedSince = (id: number) => (touchedAt.get(id) ?? 0) > launchedAt
  const byId = new Map(local.map((item) => [item.id, item]))
  const kept = fetched.flatMap((item) => {
    if (!changedSince(item.id)) return [item]
    const mine = byId.get(item.id)
    return mine ? [mine] : []
  })
  const listed = new Set(fetched.map((item) => item.id))
  return [...kept, ...local.filter((item) => !listed.has(item.id) && changedSince(item.id))]
}

function fetchBoth(projectId: number): Promise<[ProjectMember[], ProjectMember[]]> {
  return Promise.all([
    api.get<{ data: ProjectMember[] }>(`/api/projects/${projectId}/members`).then((response) => response.data),
    api.get<{ data: ProjectMember[] }>('/api/members').then((response) => response.data),
  ])
}

function isGone(error: ApiError): boolean {
  return error.status === 404 || error.status === 403
}

function describe(error: ApiError, fallback: 'addFailed' | 'removeFailed'): ActionError {
  if (error.status === 422 || error.status === 403) return { kind: 'server', message: error.message }
  return { kind: error.status === 0 ? 'network' : fallback }
}

export const useProjectMembersStore = create<ProjectMembersState>()((set, get) => ({
  ...initial,

  async open(projectId) {
    const current = ++generation
    const launchedAt = tick
    set({ ...initial, projectId, loading: true })
    try {
      const [assigned, organization] = await fetchBoth(projectId)
      if (current !== generation) return
      set({ assigned: mergeFetched(assigned, get().assigned, launchedAt), organization, loading: false })
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current !== generation) return
      set({ loading: false, failed: !isGone(caught), unavailable: isGone(caught) })
    }
  },

  async refresh() {
    const { projectId } = get()
    if (projectId === null) return
    const current = generation
    const launchedAt = tick
    try {
      const [assigned, organization] = await fetchBoth(projectId)
      if (current !== generation) return
      set({ assigned: mergeFetched(assigned, get().assigned, launchedAt), organization, failed: false })
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current === generation && isGone(caught)) set({ unavailable: true })
    }
  },

  async assign(member) {
    const { projectId, busy, loading } = get()
    if (projectId === null || busy || loading) return
    const current = generation
    set({ busy: true, actionError: null, notice: null })
    try {
      const response = await api.post<{ data: ProjectMember }>(`/api/projects/${projectId}/members`, { user_id: member.id })
      useMemberDirectoryStore.getState().invalidate(projectId)
      if (current !== generation) return
      touch(response.data.id)
      set({
        assigned: [...get().assigned.filter((item) => item.id !== response.data.id), response.data],
        notice: { kind: 'added', name: response.data.name },
      })
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current !== generation) return
      if (caught.status === 404) void get().refresh()
      else set({ actionError: describe(caught, 'addFailed') })
    } finally {
      if (current === generation) set({ busy: false })
    }
  },

  async remove(member) {
    const { projectId, busy, loading } = get()
    if (projectId === null || busy || loading) return
    const current = generation
    set({ busy: true, actionError: null, notice: null })
    try {
      await api.delete<void>(`/api/projects/${projectId}/members/${member.id}`)
      useMemberDirectoryStore.getState().invalidate(projectId)
      if (current !== generation) return
      touch(member.id)
      set({
        assigned: get().assigned.filter((item) => item.id !== member.id),
        notice: { kind: 'removed', name: member.name },
      })
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current !== generation) return
      if (caught.status === 404) void get().refresh()
      else set({ actionError: describe(caught, 'removeFailed') })
    } finally {
      if (current === generation) set({ busy: false })
    }
  },

  clear() {
    generation++
    touchedAt.clear()
    set({ ...initial })
  },
}))
