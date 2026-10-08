import { api } from './client'
import type { AcceptedInvitation, DataEnvelope, Invitation, InvitationPreview, InvitationRole } from './types'

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
  const response = await api.get<DataEnvelope<Invitation[]>>('/api/invitations', { signal })
  return response.data
}

export async function createInvitation(email: string, role: InvitationRole): Promise<Invitation> {
  const response = await api.post<DataEnvelope<Invitation>>('/api/invitations', { email, role })
  return response.data
}

export async function revokeInvitation(id: number): Promise<void> {
  await api.delete<void>(`/api/invitations/${id}`)
}
