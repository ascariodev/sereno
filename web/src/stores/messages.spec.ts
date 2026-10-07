import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { Message } from '../api/types'
import { useMessagesStore } from './messages'

const message = (id: number, channel_id = 5): Message => ({
  id,
  channel_id,
  kind: 'user',
  body: `m${id}`,
  payload: null,
  log_group_id: null,
  user: { id: 1, name: 'Ana' },
  created_at: '2026-01-01T00:00:00Z',
})
const page = (ids: number[], next: string | null) => ({ data: ids.map((id) => message(id)), meta: { next_cursor: next } })

describe('messages store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
  })

  it('keeps messages oldest first', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([3, 2, 1], null) as never)
    const store = useMessagesStore()
    await store.open(5)
    expect(store.messages.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('paginates with the cursor without duplicates', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce(page([4, 3], 'c1') as never)
      .mockResolvedValueOnce(page([3, 2, 1], null) as never)
    const store = useMessagesStore()
    await store.open(5)
    await store.loadOlder()
    expect(get).toHaveBeenLastCalledWith('/api/channels/5/messages', { query: { per_page: 50, cursor: 'c1' } })
    expect(store.messages.map((m) => m.id)).toEqual([1, 2, 3, 4])
    expect(store.nextCursor).toBeNull()
    await store.loadOlder()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('inserts with dedupe, in order, and ignores other channels', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([4, 2], null) as never)
    const store = useMessagesStore()
    await store.open(5)
    expect(store.insert(message(5))).toBe(true)
    expect(store.insert(message(3))).toBe(true)
    expect(store.insert(message(3))).toBe(false)
    expect(store.insert(message(9, 6))).toBe(false)
    expect(store.messages.map((m) => m.id)).toEqual([2, 3, 4, 5])
  })

  it('stores the error and discards stale responses after clear', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(404, 'nope'))
    const store = useMessagesStore()
    await store.open(5)
    expect(store.error?.status).toBe(404)

    let resolve: (value: unknown) => void = () => {}
    vi.spyOn(api, 'get').mockReturnValueOnce(new Promise((r) => (resolve = r)) as never)
    const pending = store.open(5)
    store.clear()
    resolve(page([1], null))
    await pending
    expect(store.messages).toEqual([])
    expect(store.channelId).toBeNull()
  })
})
