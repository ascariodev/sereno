import { api } from './client'
import type { DataEnvelope, LogGroup, LogGroupStatus, Paginated } from './types'

export interface ListLogGroupsParams {
  status?: LogGroupStatus
  level?: string
  page?: number
  perPage?: number
}

export function listLogGroups(
  projectId: number,
  params: ListLogGroupsParams = {},
  signal?: AbortSignal,
): Promise<Paginated<LogGroup>> {
  return api.get(`/api/projects/${projectId}/log-groups`, {
    query: { status: params.status, level: params.level, page: params.page, per_page: params.perPage },
    signal,
  })
}

export async function getLogGroup(projectId: number, groupId: number, signal?: AbortSignal): Promise<LogGroup> {
  const response = await api.get<DataEnvelope<LogGroup>>(`/api/projects/${projectId}/log-groups/${groupId}`, { signal })
  return response.data
}

export function updateLogGroupStatus(projectId: number, groupId: number, status: LogGroupStatus): Promise<unknown> {
  return api.patch(`/api/projects/${projectId}/log-groups/${groupId}`, { status })
}
