import { api } from './client'
import type { DataEnvelope, Member, Project } from './types'

export interface CreateProjectInput {
  name: string
  key: string
  description?: string | null
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const response = await api.post<DataEnvelope<Project>>('/api/projects', input)
  return response.data
}

export interface UpdateProjectInput {
  tasks_resolve_log_groups?: boolean
}

export async function updateProject(projectId: number, input: UpdateProjectInput): Promise<Project> {
  const response = await api.patch<DataEnvelope<Project>>(`/api/projects/${projectId}`, input)
  return response.data
}

export async function listProjectMembers(projectId: number, signal?: AbortSignal): Promise<Member[]> {
  const response = await api.get<DataEnvelope<Member[]>>(`/api/projects/${projectId}/members`, { signal })
  return response.data
}

export async function assignProjectMember(projectId: number, userId: number): Promise<Member> {
  const response = await api.post<DataEnvelope<Member>>(`/api/projects/${projectId}/members`, { user_id: userId })
  return response.data
}

export async function unassignProjectMember(projectId: number, userId: number): Promise<void> {
  await api.delete<void>(`/api/projects/${projectId}/members/${userId}`)
}
