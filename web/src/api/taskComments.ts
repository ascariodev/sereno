import { api } from './client'
import type { CursorPage, DataEnvelope, TaskComment } from './types'

const base = (projectId: number, taskId: number) => `/api/projects/${projectId}/tasks/${taskId}/comments`

/** Comments of a task, newest first; `cursor` continues towards older ones. */
export function listTaskComments(
  projectId: number,
  taskId: number,
  params: { cursor?: string | null; perPage?: number } = {},
  signal?: AbortSignal,
): Promise<CursorPage<TaskComment>> {
  return api.get(base(projectId, taskId), {
    query: { per_page: params.perPage, cursor: params.cursor ?? undefined },
    signal,
  })
}

export async function createTaskComment(
  projectId: number,
  taskId: number,
  body: string,
  attachmentIds: number[] = [],
): Promise<TaskComment> {
  const response = await api.post<DataEnvelope<TaskComment>>(base(projectId, taskId), {
    body,
    ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
  })
  return response.data
}
