import { api } from './client'
import type { DataEnvelope, InvitationRole, Member } from './types'

export async function listMembers(signal?: AbortSignal): Promise<Member[]> {
  const response = await api.get<DataEnvelope<Member[]>>('/api/members', { signal })
  return response.data
}

export async function updateMemberRole(id: number, role: InvitationRole): Promise<Member> {
  const response = await api.patch<DataEnvelope<Member>>(`/api/members/${id}`, { role })
  return response.data
}

export async function removeMember(id: number): Promise<void> {
  await api.delete<void>(`/api/members/${id}`)
}
