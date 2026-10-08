import { api } from './client'
import { isLogGroupStatus } from './types'
import type { DataEnvelope, LogGroup, LogGroupStatus, Paginated } from './types'

export interface ListLogGroupsParams {
  status?: LogGroupStatus
  /** Minimum level: returns groups at this level or more severe. */
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

export async function updateLogGroupStatus(projectId: number, groupId: number, status: LogGroupStatus): Promise<LogGroup> {
  const response = await api.patch<DataEnvelope<LogGroup>>(`/api/projects/${projectId}/log-groups/${groupId}`, { status })
  return response.data
}

export function statusFrom(updated: LogGroup | undefined): LogGroupStatus | null {
  return isLogGroupStatus(updated?.status) ? updated.status : null
}
