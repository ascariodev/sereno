import { api } from './client'
import type { DataEnvelope, LogSource, LogSourceKind, LogSourceWithKey } from './types'

export async function listLogSources(projectId: number, signal?: AbortSignal): Promise<LogSource[]> {
  const response = await api.get<DataEnvelope<LogSource[]>>(`/api/projects/${projectId}/log-sources`, { signal })
  return response.data
}

export interface CreateLogSourceInput {
  name: string
  kind?: LogSourceKind
  allowed_origins?: string[]
}

export async function createLogSource(projectId: number, input: string | CreateLogSourceInput): Promise<LogSourceWithKey> {
  const body = typeof input === 'string' ? { name: input } : input
  const response = await api.post<DataEnvelope<LogSourceWithKey>>(`/api/projects/${projectId}/log-sources`, body)
  return response.data
}

export async function rotateLogSourceKey(projectId: number, sourceId: number): Promise<LogSourceWithKey> {
  const response = await api.post<DataEnvelope<LogSourceWithKey>>(
    `/api/projects/${projectId}/log-sources/${sourceId}/rotate-key`,
  )
  return response.data
}

export async function revokeLogSource(projectId: number, sourceId: number): Promise<LogSource> {
  const response = await api.delete<DataEnvelope<LogSource>>(`/api/projects/${projectId}/log-sources/${sourceId}`)
  return response.data
}
