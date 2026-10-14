import { api } from '@/api/client'
import type { MessageAttachment } from '@/messages/store'

export interface AttachmentUrl {
  url: string
  expires_at: string
}

export async function getAttachmentUrl(attachmentId: number): Promise<AttachmentUrl> {
  const response = await api.get<{ data: AttachmentUrl }>(`/api/attachments/${attachmentId}/url`)
  return response.data
}

const UNITS = ['B', 'KB', 'MB', 'GB']

export function formatFileSize(bytes: number, locale?: string): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  if (unit < UNITS.length - 1 && Number(value.toFixed(unit === 0 ? 0 : 1)) >= 1024) {
    value /= 1024
    unit++
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${UNITS[unit]}`
}

export const ATTACHMENT_MAX_SIZE_BYTES = 5120 * 1024
export const ATTACHMENT_MAX_PER_MESSAGE = 10

export interface PickedFile {
  uri: string
  name: string
  /** Null when the picker could not tell; the API then decides with 413 or 422. */
  size: number | null
  mimeType: string | null
}

interface PickerAsset {
  uri: string
  name?: string | null
  fileName?: string | null
  size?: number | null
  fileSize?: number | null
  mimeType?: string | null
}

export function toPickedFile(asset: PickerAsset): PickedFile {
  const fromUri = decodeURIComponent(asset.uri.split(/[?#]/)[0].split('/').pop() ?? '')
  return {
    uri: asset.uri,
    name: asset.name || asset.fileName || fromUri || 'file',
    size: asset.size ?? asset.fileSize ?? null,
    mimeType: asset.mimeType ?? null,
  }
}

export async function uploadAttachment(
  channelId: number,
  file: PickedFile,
  options: { signal?: AbortSignal } = {},
): Promise<MessageAttachment> {
  const form = new FormData()
  // React Native's FormData sends a local file from this { uri, name, type } shape.
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob)
  const response = await api.post<{ data: MessageAttachment }>(`/api/channels/${channelId}/attachments`, form, {
    signal: options.signal,
  })
  return response.data
}
