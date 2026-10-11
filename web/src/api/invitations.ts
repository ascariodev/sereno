import { api } from './client'
import type { AcceptedInvitation, CursorPage, DataEnvelope, Invitation, InvitationPreview, InvitationRole } from './types'

export async function previewInvitation(token: string, signal?: AbortSignal): Promise<InvitationPreview> {
  const response = await api.get<DataEnvelope<InvitationPreview>>(`/api/invitations/${encodeURIComponent(token)}`, {
    signal,
  })
  return response.data
}

export async function acceptInvitation(token: string): Promise<AcceptedInvitation> {
  const response = await api.post<DataEnvelope<AcceptedInvitation>>('/api/invitations/accept', { token })
  return response.data
}

export async function listInvitations(signal?: AbortSignal): Promise<Invitation[]> {
  const all: Invitation[] = []
  let cursor: string | null = null
  do {
    const page: CursorPage<Invitation> = await api.get<CursorPage<Invitation>>('/api/invitations', {
      signal,
      ...(cursor !== null ? { query: { cursor } } : {}),
    })
    all.push(...page.data)
    cursor = page.meta?.next_cursor ?? null
  } while (cursor !== null)
  return all
}

export async function createInvitation(
  email: string,
  role: InvitationRole,
  projectIds?: number[],
): Promise<Invitation> {
  const body = projectIds?.length && role === 'member' ? { email, role, project_ids: projectIds } : { email, role }
  const response = await api.post<DataEnvelope<Invitation>>('/api/invitations', body)
  return response.data
}

export async function revokeInvitation(id: number): Promise<void> {
  await api.delete<void>(`/api/invitations/${id}`)
}
