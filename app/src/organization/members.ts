import { create } from 'zustand'

import { api, ApiError } from '@/api/client'
import { useOrganizationStore } from '@/organization/store'
import { useMemberDirectoryStore } from '@/projects/members'
import { useAuthStore } from '@/session/auth'

export type Role = 'owner' | 'admin' | 'member'

export interface OrganizationMember {
  id: number
  name: string
  email?: string
  role: Role | null
  joined_at: string | null
}

export type ActionError =
  | { kind: 'server'; id: number; message: string }
  | { kind: 'roleFailed' | 'removeFailed' | 'leaveFailed' | 'transferFailed' | 'reloadFailed' | 'leftReloadFailed' | 'network'; id: number }

export interface Notice {
  kind: 'removed' | 'transferred' | 'gone'
  name: string
}

interface MembersState {
  members: OrganizationMember[]
  loading: boolean
  failed: boolean
  busy: boolean
  actionError: ActionError | null
  notice: Notice | null
  open(): Promise<void>
  refresh(): Promise<void>
  changeRole(member: OrganizationMember, role: Role): Promise<void>
  remove(member: OrganizationMember): Promise<boolean>
  transfer(member: OrganizationMember): Promise<void>
  clear(): void
}

const initial = {
  members: [] as OrganizationMember[],
  loading: false,
  failed: false,
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

function mergeFetched(fetched: OrganizationMember[], local: OrganizationMember[], launchedAt: number): OrganizationMember[] {
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

async function fetchMembers(): Promise<OrganizationMember[]> {
  const response = await api.get<{ data: OrganizationMember[] }>('/api/members')
  return response.data
}

function describe(error: ApiError, id: number, fallback: 'roleFailed' | 'removeFailed' | 'leaveFailed' | 'transferFailed'): ActionError {
  if (error.status === 422 || error.status === 403) return { kind: 'server', id, message: error.message }
  return { kind: error.status === 0 ? 'network' : fallback, id }
}

export function assignableRolesFor(roles: string[], targetRole: Role | null): Role[] {
  if (roles.includes('owner')) return ['owner', 'admin', 'member']
  if (roles.includes('admin') && targetRole !== 'owner') return ['admin', 'member']
  return []
}

export function canRemoveMember(roles: string[], targetRole: Role | null): boolean {
  return roles.includes('owner') || (roles.includes('admin') && targetRole !== 'owner')
}

function activeRoles(): string[] {
  return useOrganizationStore.getState().active()?.roles ?? []
}

function selfId(): number | null {
  return useAuthStore.getState().user?.id ?? null
}

async function reloadOrganizations(): Promise<boolean> {
  await useOrganizationStore.getState().load()
  return !useOrganizationStore.getState().loadError
}

export const useOrganizationMembersStore = create<MembersState>()((set, get) => ({
  ...initial,

  async open() {
    const current = ++generation
    const launchedAt = tick
    set({ ...initial, loading: true })
    try {
      const fetched = await fetchMembers()
      if (current !== generation) return
      set({ members: mergeFetched(fetched, get().members, launchedAt), loading: false })
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current !== generation) return
      set({ loading: false, failed: true })
    }
  },

  async refresh() {
    const { loading, busy } = get()
    if (loading || busy) return
    const current = generation
    const launchedAt = tick
    try {
      const fetched = await fetchMembers()
      if (current !== generation || get().busy) return
      set({ members: mergeFetched(fetched, get().members, launchedAt), failed: false })
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
    }
  },

  async changeRole(member, role) {
    const { busy, loading } = get()
    if (busy || loading || role === member.role) return
    if (!assignableRolesFor(activeRoles(), member.role).includes(role)) return
    const current = generation
    set({ busy: true, actionError: null, notice: null })
    try {
      const response = await api.patch<{ data: OrganizationMember }>(`/api/members/${member.id}`, { role })
      useMemberDirectoryStore.getState().invalidate()
      if (current !== generation) return
      touch(response.data.id)
      set({ members: get().members.map((item) => (item.id === response.data.id ? response.data : item)) })
      if (member.id === selfId() && !(await reloadOrganizations()) && current === generation) {
        set({ actionError: { kind: 'reloadFailed', id: member.id } })
      }
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current !== generation) return
      if (caught.status === 404) void get().refresh()
      else set({ actionError: describe(caught, member.id, 'roleFailed') })
    } finally {
      if (current === generation) set({ busy: false })
    }
  },

  async remove(member) {
    const { busy, loading } = get()
    if (busy || loading) return false
    const self = member.id === selfId()
    if (!self && !canRemoveMember(activeRoles(), member.role)) return false
    const current = generation
    set({ busy: true, actionError: null, notice: null })
    try {
      await api.delete<void>(`/api/members/${member.id}`)
      useMemberDirectoryStore.getState().invalidate()
      if (self) {
        if (await reloadOrganizations()) return true
        if (current === generation) set({ actionError: { kind: 'leftReloadFailed', id: member.id } })
        return false
      }
      if (current !== generation) return false
      touch(member.id)
      set({
        members: get().members.filter((item) => item.id !== member.id),
        notice: { kind: 'removed', name: member.name },
      })
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current !== generation) return false
      if (caught.status === 404) {
        touch(member.id)
        set({
          members: get().members.filter((item) => item.id !== member.id),
          notice: { kind: 'gone', name: member.name },
        })
      } else set({ actionError: describe(caught, member.id, self ? 'leaveFailed' : 'removeFailed') })
    } finally {
      if (current === generation) set({ busy: false })
    }
    return false
  },

  async transfer(member) {
    const { busy, loading } = get()
    if (busy || loading || !activeRoles().includes('owner') || member.id === selfId()) return
    const current = generation
    set({ busy: true, actionError: null, notice: null })
    try {
      await api.post<unknown>(`/api/members/${member.id}/transfer-ownership`)
      useMemberDirectoryStore.getState().invalidate()
      const reloaded = await reloadOrganizations()
      if (current !== generation) return
      set({ busy: false })
      await get().open()
      set({
        notice: { kind: 'transferred', name: member.name },
        actionError: reloaded ? null : { kind: 'reloadFailed', id: member.id },
      })
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current !== generation) return
      if (caught.status === 404) {
        touch(member.id)
        set({
          members: get().members.filter((item) => item.id !== member.id),
          notice: { kind: 'gone', name: member.name },
        })
      } else set({ actionError: describe(caught, member.id, 'transferFailed') })
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
