import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { Message } from '../api/types'
import { CATCH_UP_MAX_PAGES, useMessagesStore } from './messages'
import { useThreadStore } from './thread'

const reply = (id: number, parent_id: number | null = 10, channel_id = 5): Message => ({
  id,
  channel_id,
  kind: 'user',
  body: `r${id}`,
  payload: null,
  log_group_id: null,
  parent_id,
  replies_count: 0,
  last_reply_at: null,
  mentions: [],
  attachments: [],
  user: { id: 1, name: 'Ana' },
  created_at: `2026-01-01T00:00:${String(id % 60).padStart(2, '0')}Z`,
})
const page = (ids: number[], next: string | null) => ({ data: ids.map((id) => reply(id)), meta: { next_cursor: next } })
const ids = (list: readonly Message[]) => list.map((m) => m.id)

function deferred(): { promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void } {
  let resolve: (value: unknown) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('thread store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
  })

  it('opens a thread with its replies oldest first', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(page([13, 12, 11], 'c1') as never)
    const store = useThreadStore()
    await store.open(5, 10)
    expect(get).toHaveBeenCalledWith('/api/channels/5/messages/10/replies', {
      query: { per_page: 50, cursor: undefined },
      signal: expect.any(AbortSignal),
    })
    expect(store.channelId).toBe(5)
    expect(store.rootId).toBe(10)
    expect(ids(store.replies)).toEqual([11, 12, 13])
    expect(store.nextCursor).toBe('c1')
    expect(store.loading).toBe(false)
  })

  it('keeps a live reply that arrives while the thread is loading', async () => {
    const pending = deferred()
    vi.spyOn(api, 'get').mockReturnValue(pending.promise as never)
    const store = useThreadStore()
    const opening = store.open(5, 10)
    expect(store.loading).toBe(true)
    expect(store.insert(reply(14))).toBe(true)
    pending.resolve(page([13, 12], null))
    await opening
    expect(ids(store.replies)).toEqual([12, 13, 14])
  })

  it('stores the error of a failed open', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, 'nope'))
    const store = useThreadStore()
    await store.open(5, 10)
    expect(store.error?.status).toBe(404)
    expect(store.loading).toBe(false)
  })

  it('discards a pending open after clear or a newer open, and aborts its request', async () => {
    const first = deferred()
    const get = vi.spyOn(api, 'get').mockReturnValueOnce(first.promise as never)
    const store = useThreadStore()
    const opening = store.open(5, 10)
    const signal = (get.mock.calls[0][1] as { signal: AbortSignal }).signal
    store.clear()
    expect(signal.aborted).toBe(true)
    first.resolve(page([11], null))
    await opening
    expect(store.replies).toEqual([])
    expect(store.rootId).toBeNull()

    const stale = deferred()
    get.mockReturnValueOnce(stale.promise as never).mockResolvedValueOnce({ data: [reply(31, 30)], meta: { next_cursor: null } } as never)
    const old = store.open(5, 10)
    await store.open(5, 30)
    stale.reject(new ApiError(500, 'late'))
    await old
    expect(store.rootId).toBe(30)
    expect(ids(store.replies)).toEqual([31])
    expect(store.error).toBeNull()
  })

  it('inserts only replies of the open root, with dedupe and in order', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([14, 12], null) as never)
    const store = useThreadStore()
    expect(store.insert(reply(11))).toBe(false)
    await store.open(5, 10)
    expect(store.insert(reply(13))).toBe(true)
    expect(store.insert(reply(13))).toBe(false)
    expect(store.insert(reply(15, 20))).toBe(false)
    expect(store.insert(reply(16, null))).toBe(false)
    expect(store.insert(reply(17, 10, 6))).toBe(false)
    expect(ids(store.replies)).toEqual([12, 13, 14])
  })

  it('loads older replies with the cursor without duplicates', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce(page([14, 13], 'c1') as never)
      .mockResolvedValueOnce(page([13, 12, 11], null) as never)
    const store = useThreadStore()
    await store.open(5, 10)
    await store.loadOlder()
    expect(get).toHaveBeenLastCalledWith('/api/channels/5/messages/10/replies', {
      query: { per_page: 50, cursor: 'c1' },
      signal: expect.any(AbortSignal),
    })
    expect(ids(store.replies)).toEqual([11, 12, 13, 14])
    expect(store.nextCursor).toBeNull()
    await store.loadOlder()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('discards a pending loadOlder after clear', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([14], 'c1') as never)
    const store = useThreadStore()
    await store.open(5, 10)
    const older = deferred()
    get.mockReturnValueOnce(older.promise as never)
    const loading = store.loadOlder()
    expect(store.loadingMore).toBe(true)
    store.clear()
    older.resolve(page([13], null))
    await loading
    expect(store.replies).toEqual([])
    expect(store.loadingMore).toBe(false)
  })

  describe('send', () => {
    it('adds the reply to the thread and bumps the root counter in the channel', async () => {
      vi.spyOn(api, 'get')
        .mockResolvedValueOnce({ data: [{ ...reply(10, null) }], meta: { next_cursor: null } } as never)
        .mockResolvedValueOnce(page([11], null) as never)
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: reply(12) } as never)
      const messages = useMessagesStore()
      await messages.open(5)
      const store = useThreadStore()
      await store.open(5, 10)
      await store.send('hi')
      expect(post).toHaveBeenCalledWith('/api/channels/5/messages', { body: 'hi', parent_id: 10 })
      expect(ids(store.replies)).toEqual([11, 12])
      expect(messages.messages[0].replies_count).toBe(1)
      messages.insert(reply(12))
      expect(messages.messages[0].replies_count).toBe(1)
    })

    it('sends attachment ids with an empty body', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([], null) as never)
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: reply(12) } as never)
      const store = useThreadStore()
      await store.open(5, 10)
      await store.send('', [4])
      expect(post).toHaveBeenCalledWith('/api/channels/5/messages', { body: '', parent_id: 10, attachment_ids: [4] })
    })

    it('does not add a sent reply to a thread cleared or replaced meanwhile', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      const response = deferred()
      vi.spyOn(api, 'post').mockReturnValueOnce(response.promise as never)
      const sending = store.send('hi')
      await store.open(5, 10)
      response.resolve({ data: reply(12) })
      await sending
      expect(store.replies).toEqual([])
    })

    it('propagates the API error', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([], null) as never)
      vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid'))
      const store = useThreadStore()
      await store.open(5, 10)
      await expect(store.send('hi')).rejects.toBeInstanceOf(ApiError)
    })
  })

  describe('catchUp', () => {
    it('follows the cursor until it joins the loaded replies', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([12, 11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      get
        .mockResolvedValueOnce(page([16, 15], 'c1') as never)
        .mockResolvedValueOnce(page([14, 13, 12], 'c2') as never)
      await store.catchUp()
      expect(get).toHaveBeenCalledTimes(3)
      expect(get).toHaveBeenLastCalledWith('/api/channels/5/messages/10/replies', {
        query: { per_page: 50, cursor: 'c1' },
        signal: expect.any(AbortSignal),
      })
      expect(ids(store.replies)).toEqual([11, 12, 13, 14, 15, 16])
    })

    it('resets to the newest page when the cap is reached, keeping newer live replies', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([12, 11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      const first = deferred()
      get.mockReturnValueOnce(first.promise as never)
      get.mockResolvedValue(page([100], 'more') as never)
      const catching = store.catchUp()
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2))
      store.insert(reply(300))
      first.resolve(page([200, 199], 'newest'))
      await catching
      expect(get).toHaveBeenCalledTimes(1 + CATCH_UP_MAX_PAGES)
      expect(ids(store.replies)).toEqual([199, 200, 300])
      expect(store.nextCursor).toBe('newest')
    })

    it('keeps the reset list when a pending loadOlder resolves afterwards', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([14, 13], 'old') as never)
      const store = useThreadStore()
      await store.open(5, 10)
      const older = deferred()
      get.mockReturnValueOnce(older.promise as never)
      const loading = store.loadOlder()
      get.mockResolvedValueOnce(page([200, 199], 'newest') as never)
      get.mockResolvedValue(page([100], 'more') as never)
      await store.catchUp()
      expect(store.loadingMore).toBe(false)
      older.resolve(page([12, 11], null))
      await loading
      expect(ids(store.replies)).toEqual([199, 200])
      expect(store.nextCursor).toBe('newest')
      expect(store.loadingMore).toBe(false)
    })

    it('waits for an open still in flight instead of racing it', async () => {
      const opened = deferred()
      const get = vi.spyOn(api, 'get').mockReturnValueOnce(opened.promise as never)
      const store = useThreadStore()
      const opening = store.open(5, 10)
      get.mockResolvedValueOnce(page([14, 13, 12], 'c1') as never)
      const catching = store.catchUp()
      expect(get).toHaveBeenCalledTimes(1)
      opened.resolve(page([12, 11], null))
      await opening
      await catching
      expect(get).toHaveBeenCalledTimes(2)
      expect(ids(store.replies)).toEqual([11, 12, 13, 14])
    })

    it('discards the result after clear or after opening another thread', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      const late = deferred()
      get.mockReturnValueOnce(late.promise as never)
      const catching = store.catchUp()
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2))
      get.mockResolvedValueOnce({ data: [reply(31, 30)], meta: { next_cursor: null } } as never)
      await store.open(5, 30)
      late.resolve(page([12, 11], null))
      await catching
      expect(store.rootId).toBe(30)
      expect(ids(store.replies)).toEqual([31])

      store.clear()
      await store.catchUp()
      expect(get).toHaveBeenCalledTimes(3)
    })

    it('does nothing after a failed open', async () => {
      const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(404, 'nope'))
      const store = useThreadStore()
      await store.open(5, 10)
      await store.catchUp()
      expect(get).toHaveBeenCalledTimes(1)
      expect(store.error?.status).toBe(404)
    })

    it('still catches up after a failed loadOlder', async () => {
      const get = vi
        .spyOn(api, 'get')
        .mockResolvedValueOnce(page([12, 11], 'c1') as never)
        .mockRejectedValueOnce(new ApiError(0, 'offline'))
      const store = useThreadStore()
      await store.open(5, 10)
      await store.loadOlder()
      expect(store.error?.status).toBe(0)
      get.mockResolvedValueOnce(page([14, 13, 12], 'c2') as never)
      await store.catchUp()
      expect(get).toHaveBeenCalledTimes(3)
      expect(ids(store.replies)).toEqual([11, 12, 13, 14])
    })
  })
})
