import { api } from './client'
import type { MentionPage } from './types'

export const MENTIONS_PER_PAGE = 30
/** Maximum ids the API accepts in one `POST /api/mentions/read`. */
export const MENTIONS_READ_MAX_IDS = 100

export function listMentions(
  params: { cursor?: string | null; perPage?: number } = {},
  signal?: AbortSignal,
): Promise<MentionPage> {
  return api.get('/api/mentions', {
    query: { per_page: params.perPage, cursor: params.cursor ?? undefined },
    signal,
  })
}

export async function markMentionsRead(selection: { ids: number[] } | { all: true }): Promise<number> {
  const response = await api.post<{ unread_count: number }>('/api/mentions/read', selection)
  return response.unread_count
}
