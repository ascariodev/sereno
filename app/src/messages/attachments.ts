import { api } from '@/api/client'

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
