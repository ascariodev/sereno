import { api } from './client'
import type { AttachmentUrl, CursorPage, DataEnvelope, TaskComment } from './types'

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

export async function updateTaskComment(
  projectId: number,
  taskId: number,
  commentId: number,
  body: string,
  removeAttachmentIds: number[] = [],
): Promise<TaskComment> {
  const payload = removeAttachmentIds.length > 0 ? { body, remove_attachment_ids: removeAttachmentIds } : { body }
  const response = await api.patch<DataEnvelope<TaskComment>>(`${base(projectId, taskId)}/${commentId}`, payload)
  return response.data
}

export function deleteTaskComment(projectId: number, taskId: number, commentId: number): Promise<void> {
  return api.delete(`${base(projectId, taskId)}/${commentId}`)
}

/** Upload endpoint for comment attachments of a task, for `useAttachmentUploads`. */
export function taskAttachmentsPath(projectId: number, taskId: number): string {
  return `/api/projects/${projectId}/tasks/${taskId}/attachments`
}

export async function getTaskAttachmentUrl(attachmentId: number): Promise<AttachmentUrl> {
  const response = await api.get<DataEnvelope<AttachmentUrl>>(`/api/task-attachments/${attachmentId}/url`)
  return response.data
}
