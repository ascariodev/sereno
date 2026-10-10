import { api } from './client'
import type { DataEnvelope, Organization } from './types'

export async function createOrganization(name: string): Promise<Organization> {
  const response = await api.post<DataEnvelope<Organization>>('/api/organizations', { name })
  return response.data
}
