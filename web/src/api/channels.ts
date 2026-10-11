import { api } from './client'
import type { Channel, CursorPage, DataEnvelope } from './types'

export async function listAllChannels(options: { includeArchived?: boolean } = {}): Promise<Channel[]> {
  const all: Channel[] = []
  let cursor: string | null = null
  do {
    const query: Record<string, string | number> = {}
    if (options.includeArchived) query.include_archived = 1
    if (cursor !== null) query.cursor = cursor
    const page: CursorPage<Channel> = await api.get<CursorPage<Channel>>(
      '/api/channels',
      Object.keys(query).length > 0 ? { query } : undefined,
    )
    all.push(...page.data)
    cursor = page.meta?.next_cursor ?? null
  } while (cursor !== null)
  return all
}

export async function getChannel(id: number): Promise<Channel> {
  const response = await api.get<DataEnvelope<Channel>>(`/api/channels/${id}`)
  return response.data
}
