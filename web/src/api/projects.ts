import { api } from './client'
import type { DataEnvelope, Project } from './types'

export interface CreateProjectInput {
  name: string
  key: string
  description?: string | null
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const response = await api.post<DataEnvelope<Project>>('/api/projects', input)
  return response.data
}
