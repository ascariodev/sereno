import { api } from './client'
import type { DataEnvelope, LogSource, LogSourceWithKey } from './types'

export async function listLogSources(projectId: number, signal?: AbortSignal): Promise<LogSource[]> {
  const response = await api.get<DataEnvelope<LogSource[]>>(`/api/projects/${projectId}/log-sources`, { signal })
  return response.data
}

export async function createLogSource(projectId: number, name: string): Promise<LogSourceWithKey> {
  const response = await api.post<DataEnvelope<LogSourceWithKey>>(`/api/projects/${projectId}/log-sources`, { name })
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
