import { create } from 'zustand'

import { api, ApiError } from '@/api/client'

export interface LogSource {
  id: number
  project_id: number
  name: string
  key_prefix: string
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

export interface IssuedSource extends LogSource {
  key: string
}

export type ActionError = 'conflict' | 'archived' | 'revoked' | 'unavailable' | 'forbidden' | 'failed'

function withoutKey(issued: IssuedSource): LogSource {
  const listed: Partial<IssuedSource> = { ...issued }
  delete listed.key
  return listed as LogSource
}

function unavailable(error: ApiError): ActionError {
  if (error.errors.project) return 'archived'
  if (error.errors.source) return 'revoked'
  return 'unavailable'
}

interface IntegrationsState {
  projectId: number | null
  sources: LogSource[]
  issued: IssuedSource | null
  loading: boolean
  failed: boolean
  actionError: ActionError | null
  revokedName: string | null
  busy: boolean
  open(projectId: number): Promise<void>
  refresh(): Promise<void>
  create(name: string): Promise<void>
  rotate(source: LogSource): Promise<void>
  revoke(source: LogSource): Promise<boolean>
  applyConnected(id: number, lastUsedAt: string): void
  dismissIssued(): void
  clearFeedback(): void
  clear(): void
}

const initial = {
  projectId: null,
  sources: [] as LogSource[],
  issued: null as IssuedSource | null,
  loading: false,
  failed: false,
  actionError: null as ActionError | null,
  revokedName: null as string | null,
  busy: false,
}

let generation = 0
let tick = 0
const touchedAt = new Map<number, number>()

function touch(id: number): void {
  touchedAt.set(id, ++tick)
}

function mergeFetched(fetched: LogSource[], local: LogSource[], launchedAt: number): LogSource[] {
  const changedSince = (id: number) => (touchedAt.get(id) ?? 0) > launchedAt
  const byId = new Map(local.map((item) => [item.id, item]))
  const merged = fetched.map((item) => (changedSince(item.id) ? (byId.get(item.id) ?? item) : item))
  const listed = new Set(fetched.map((item) => item.id))
  return [...merged, ...local.filter((item) => !listed.has(item.id) && changedSince(item.id))]
}

function path(projectId: number): string {
  return `/api/projects/${projectId}/log-sources`
}

export const useIntegrationsStore = create<IntegrationsState>()((set, get) => ({
  ...initial,

  async open(projectId) {
    const current = ++generation
    const launchedAt = tick
    set({ ...initial, projectId, loading: true })
    try {
      const response = await api.get<{ data: LogSource[] }>(path(projectId))
      if (current !== generation) return
      set({ sources: mergeFetched(response.data, get().sources, launchedAt), loading: false })
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current !== generation) return
      set({ loading: false, failed: true })
    }
  },

  async refresh() {
    const { projectId } = get()
    if (projectId === null) return
    const current = generation
    const launchedAt = tick
    try {
      const response = await api.get<{ data: LogSource[] }>(path(projectId))
      if (current !== generation) return
      set({ sources: mergeFetched(response.data, get().sources, launchedAt) })
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
    }
  },

  async create(name) {
    const { projectId } = get()
    if (projectId === null) return
    const created = await api.post<{ data: IssuedSource }>(path(projectId), { name })
    if (projectId !== get().projectId) return
    const listed = withoutKey(created.data)
    touch(listed.id)
    set({
      sources: [...get().sources.filter((item) => item.id !== listed.id), listed],
      issued: created.data,
    })
  },

  async rotate(source) {
    const { projectId, busy } = get()
    if (projectId === null || busy) return
    const current = generation
    set({ busy: true, actionError: null, revokedName: null })
    try {
      const response = await api.post<{ data: IssuedSource }>(`${path(projectId)}/${source.id}/rotate-key`)
      if (current !== generation) return
      const listed = withoutKey(response.data)
      touch(listed.id)
      set({
        sources: get().sources.map((item) => (item.id === listed.id ? listed : item)),
        issued: response.data,
      })
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current !== generation) return
      if (caught.status === 409) set({ actionError: 'conflict' })
      else if (caught.status === 422) set({ actionError: unavailable(caught) })
      else set({ actionError: caught.status === 403 ? 'forbidden' : 'failed' })
      if (caught.status === 409 || caught.status === 422) void get().refresh()
    } finally {
      if (current === generation) set({ busy: false })
    }
  },

  async revoke(source) {
    const { projectId, busy } = get()
    if (projectId === null || busy) return false
    const current = generation
    set({ busy: true, actionError: null, revokedName: null })
    try {
      const response = await api.delete<{ data: LogSource }>(`${path(projectId)}/${source.id}`)
      if (current !== generation) return false
      touch(response.data.id)
      set({
        sources: get().sources.map((item) => (item.id === response.data.id ? response.data : item)),
        revokedName: source.name,
      })
      return true
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current !== generation) return false
      set({ actionError: caught.status === 403 ? 'forbidden' : 'failed' })
      return false
    } finally {
      if (current === generation) set({ busy: false })
    }
  },

  applyConnected(id, lastUsedAt) {
    touch(id)
    set({
      sources: get().sources.map((item) => (item.id === id ? { ...item, last_used_at: lastUsedAt } : item)),
    })
  },

  dismissIssued() {
    set({ issued: null })
  },

  clearFeedback() {
    set({ actionError: null, revokedName: null })
  },

  clear() {
    generation++
    touchedAt.clear()
    set({ ...initial })
  },
}))
