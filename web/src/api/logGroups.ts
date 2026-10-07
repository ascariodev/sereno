import { api } from './client'
import type { LogGroupStatus } from './types'

export function updateLogGroupStatus(projectId: number, groupId: number, status: LogGroupStatus): Promise<unknown> {
  return api.patch(`/api/projects/${projectId}/log-groups/${groupId}`, { status })
}
