import { create } from 'zustand'

import { api, ApiError, type FieldErrors } from '@/api/client'
import { useOrganizationStore } from '@/organization/store'

export type InvitationRole = 'owner' | 'admin' | 'member'

export interface Invitation {
  id: number
  email: string
  role: InvitationRole
  invited_by: { id: number; name: string } | null
  projects: { id: number; name: string; key: string }[]
  expires_at: string
}

export type FormErrorKind = 'forbidden' | 'tooManyAttempts' | 'network' | 'failed'

export type RevokeNotice = { kind: 'sent' | 'revoked' | 'gone'; email: string } | { kind: 'forbidden' | 'failed' | 'network' }

interface InvitationsState {
  invitations: Invitation[]
  loading: boolean
  failed: boolean
  submitting: boolean
  revoking: boolean
  fieldErrors: FieldErrors
  formError: { kind: 'server'; message: string } | { kind: FormErrorKind } | null
  notice: RevokeNotice | null
  open(): Promise<void>
  invite(email: string, role: InvitationRole, projectIds: number[]): Promise<boolean>
  revoke(invitation: Invitation): Promise<void>
  clearForm(): void
  clear(): void
}

const initial = {
  invitations: [] as Invitation[],
  loading: false,
  failed: false,
  submitting: false,
  revoking: false,
  fieldErrors: {} as FieldErrors,
  formError: null as InvitationsState['formError'],
  notice: null as RevokeNotice | null,
}

let generation = 0

export function invitableRolesFor(roles: string[]): InvitationRole[] {
  if (roles.includes('owner')) return ['member', 'admin', 'owner']
  if (roles.includes('admin')) return ['member', 'admin']
  return []
}

export function canRevokeInvitation(roles: string[], invitationRole: InvitationRole): boolean {
  return roles.includes('owner') || (roles.includes('admin') && invitationRole !== 'owner')
}

function activeRoles(): string[] {
  return useOrganizationStore.getState().active()?.roles ?? []
}

async function fetchInvitations(): Promise<Invitation[]> {
  const all: Invitation[] = []
  let cursor: string | null = null
  do {
    const page: { data: Invitation[]; meta?: { next_cursor: string | null } } = await api.get('/api/invitations', {
      query: { cursor },
    })
    all.push(...page.data)
    cursor = page.meta?.next_cursor ?? null
  } while (cursor !== null)
  return all
}

export const useInvitationsStore = create<InvitationsState>()((set, get) => ({
  ...initial,

  async open() {
    const current = ++generation
    set({ ...initial, loading: true })
    try {
      const invitations = await fetchInvitations()
      if (current !== generation) return
      set({ invitations, loading: false })
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current !== generation) return
      set({ loading: false, failed: true })
    }
  },

  async invite(email, role, projectIds) {
    const { loading, submitting, revoking } = get()
    if (loading || submitting || revoking || !invitableRolesFor(activeRoles()).includes(role)) return false
    const current = generation
    set({ submitting: true, fieldErrors: {}, formError: null, notice: null })
    try {
      const body = role === 'member' && projectIds.length > 0 ? { email, role, project_ids: projectIds } : { email, role }
      const response = await api.post<{ data: Invitation }>('/api/invitations', body)
      if (current !== generation) return false
      const created = response.data
      const key = created.email.toLowerCase()
      set({
        invitations: [created, ...get().invitations.filter((item) => item.email.toLowerCase() !== key)],
        notice: { kind: 'sent', email: created.email },
      })
      return true
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current !== generation) return false
      if (caught.status === 422) {
        const known = Object.keys(caught.errors).some((key) => key === 'email' || key === 'role' || key.startsWith('project_ids'))
        set({ fieldErrors: caught.errors, formError: known ? null : { kind: 'server', message: caught.message } })
      } else if (caught.status === 403) set({ formError: { kind: 'forbidden' } })
      else if (caught.status === 429) set({ formError: { kind: 'tooManyAttempts' } })
      else set({ formError: { kind: caught.status === 0 ? 'network' : 'failed' } })
      return false
    } finally {
      if (current === generation) set({ submitting: false })
    }
  },

  async revoke(invitation) {
    const { loading, submitting, revoking } = get()
    if (loading || submitting || revoking || !canRevokeInvitation(activeRoles(), invitation.role)) return
    const current = generation
    set({ revoking: true, notice: null })
    const drop = () => get().invitations.filter((item) => item.id !== invitation.id)
    try {
      await api.delete<void>(`/api/invitations/${invitation.id}`)
      if (current !== generation) return
      set({ invitations: drop(), notice: { kind: 'revoked', email: invitation.email } })
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught
      if (current !== generation) return
      if (caught.status === 404) set({ invitations: drop(), notice: { kind: 'gone', email: invitation.email } })
      else if (caught.status === 403) set({ notice: { kind: 'forbidden' } })
      else set({ notice: { kind: caught.status === 0 ? 'network' : 'failed' } })
    } finally {
      if (current === generation) set({ revoking: false })
    }
  },

  clearForm() {
    set({ fieldErrors: {}, formError: null })
  },

  clear() {
    generation++
    set({ ...initial })
  },
}))
