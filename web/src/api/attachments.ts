import { api } from './client'
import type { DataEnvelope, MessageAttachment } from './types'

/** Uploads a file to an attachments endpoint (`path` relative to the API, e.g. `/api/channels/1/attachments`). */
export async function uploadAttachmentTo(
  path: string,
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<MessageAttachment> {
  const form = new FormData()
  form.append('file', file)
  const response = await api.post<DataEnvelope<MessageAttachment>>(path, form, { signal: options.signal })
  return response.data
}

export function uploadAttachment(
  channelId: number,
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<MessageAttachment> {
  return uploadAttachmentTo(`/api/channels/${channelId}/attachments`, file, options)
}
