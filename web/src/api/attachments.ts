import { api } from './client'
import type { DataEnvelope, MessageAttachment } from './types'

export async function uploadAttachment(
  channelId: number,
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<MessageAttachment> {
  const form = new FormData()
  form.append('file', file)
  const response = await api.post<DataEnvelope<MessageAttachment>>(
    `/api/channels/${channelId}/attachments`,
    form,
    { signal: options.signal },
  )
  return response.data
}
