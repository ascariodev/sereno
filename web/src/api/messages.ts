import { api } from './client'
import type { DataEnvelope, DeleteMessageResponse, Message, RepliesPage } from './types'

export function listReplies(
  channelId: number,
  messageId: number,
  params: { cursor?: string | null; perPage?: number } = {},
  signal?: AbortSignal,
): Promise<RepliesPage> {
  return api.get(`/api/channels/${channelId}/messages/${messageId}/replies`, {
    query: { per_page: params.perPage, cursor: params.cursor ?? undefined },
    signal,
  })
}

export async function sendReply(
  channelId: number,
  parentId: number,
  body: string,
  attachmentIds: number[] = [],
): Promise<Message> {
  const response = await api.post<DataEnvelope<Message>>(`/api/channels/${channelId}/messages`, {
    body,
    parent_id: parentId,
    ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
  })
  return response.data
}

export async function updateMessage(channelId: number, messageId: number, body: string): Promise<Message> {
  const response = await api.patch<DataEnvelope<Message>>(`/api/channels/${channelId}/messages/${messageId}`, { body })
  return response.data
}

export function deleteMessage(channelId: number, messageId: number): Promise<DeleteMessageResponse> {
  return api.delete(`/api/channels/${channelId}/messages/${messageId}`)
}
