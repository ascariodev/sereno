import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { Message, MessageDeletedEvent } from '../api/types'
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
  recent_participants: [],
  last_reply_at: null,
  mentions: [],
  attachments: [],
  user: { id: 1, name: 'Ana' },
  created_at: `2026-01-01T00:00:${String(id % 60).padStart(2, '0')}Z`,
  edited_at: null,
  deleted_at: null,
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

  it('sorts the first page by id even when the API returns it unordered', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([12, 13, 11], null) as never)
    const store = useThreadStore()
    await store.open(5, 10)
    expect(ids(store.replies)).toEqual([11, 12, 13])
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

  it('keeps the root from meta.root and bumps its counters with new live replies only', async () => {
    const root = { ...reply(10, null), replies_count: 2, last_reply_at: '2026-01-01T00:00:12Z' }
    vi.spyOn(api, 'get').mockResolvedValue({ ...page([12, 11], null), meta: { next_cursor: null, root } } as never)
    const store = useThreadStore()
    await store.open(5, 10)
    expect(store.root).toEqual(root)
    expect(store.insert(reply(13))).toBe(true)
    expect(store.insert(reply(13))).toBe(false)
    expect(store.insert(reply(20, 99))).toBe(false)
    expect(store.root?.replies_count).toBe(3)
    expect(store.root?.last_reply_at).toBe('2026-01-01T00:00:13Z')
    store.clear()
    expect(store.root).toBeNull()
  })

  it('does not lower the root counters when catchUp brings an older count', async () => {
    const root = { ...reply(10, null), replies_count: 1, last_reply_at: '2026-01-01T00:00:11Z' }
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ ...page([11], null), meta: { next_cursor: null, root } } as never)
    const store = useThreadStore()
    await store.open(5, 10)
    store.insert(reply(12))
    get.mockResolvedValueOnce({ ...page([12, 11], null), meta: { next_cursor: null, root: { ...root, body: 'edited' } } } as never)
    await store.catchUp()
    expect(store.root).toMatchObject({ body: 'edited', replies_count: 2, last_reply_at: '2026-01-01T00:00:12Z' })
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

    it('catches up again after a failed open followed by a successful one', async () => {
      const get = vi
        .spyOn(api, 'get')
        .mockRejectedValueOnce(new ApiError(404, 'nope'))
        .mockResolvedValueOnce(page([12, 11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      await store.open(5, 10)
      get.mockResolvedValueOnce(page([13, 12, 11], null) as never)
      await store.catchUp()
      expect(get).toHaveBeenCalledTimes(3)
      expect(ids(store.replies)).toEqual([11, 12, 13])
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

  describe('edits and deletions', () => {
    const at = (second: number) => `2026-01-01T00:01:${String(second).padStart(2, '0')}Z`
    const root = (extra: Partial<Message> = {}): Message => ({ ...reply(10, null), replies_count: 3, last_reply_at: '2026-01-01T00:00:13Z', ...extra })
    const withRoot = (list: number[], next: string | null, rootExtra: Partial<Message> = {}) => ({
      ...page(list, next),
      meta: { next_cursor: next, root: root(rootExtra) },
    })
    const deleted = (id: number, parent_id: number | null, counters: { replies_count: number; last_reply_at: string | null }, second = 30): MessageDeletedEvent => ({
      id,
      channel_id: 5,
      parent_id,
      deleted_at: at(second),
      root: { id: 10, ...counters },
    })
    const edited = (id: number, body: string, second: number, parent_id: number | null = 10): Message => ({
      ...reply(id, parent_id),
      body,
      edited_at: at(second),
    })

    it('replaces an edited reply in live and ignores older edits, other threads and unknown replies', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(withRoot([13, 12, 11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      expect(store.replace(edited(12, 'new', 20))).toBe(true)
      expect(store.replies.find((m) => m.id === 12)?.body).toBe('new')
      expect(store.replace(edited(12, 'older', 10))).toBe(false)
      expect(store.replace({ ...edited(12, 'other channel', 25), channel_id: 6 })).toBe(false)
      expect(store.replace(edited(40, 'other thread', 25, 99))).toBe(false)
      expect(store.replace(edited(14, 'not loaded', 25))).toBe(false)
      expect(store.replies.find((m) => m.id === 12)?.body).toBe('new')
      expect(ids(store.replies)).toEqual([11, 12, 13])
    })

    it('edits the root content keeping its counters, and keeps the edit over an older snapshot', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValue(withRoot([13, 12, 11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      store.insert(reply(14))
      expect(store.replace({ ...edited(10, 'root edited', 20, null), replies_count: 0, last_reply_at: null })).toBe(true)
      expect(store.root).toMatchObject({ body: 'root edited', replies_count: 4, last_reply_at: '2026-01-01T00:00:14Z' })
      get.mockResolvedValueOnce(withRoot([14, 13, 12, 11], null, { replies_count: 4, last_reply_at: '2026-01-01T00:00:14Z' }) as never)
      await store.catchUp()
      expect(store.root).toMatchObject({ body: 'root edited', replies_count: 4 })
    })

    it('does not revert a live edit of a reply with an older snapshot from open, loadOlder or catchUp', async () => {
      const opened = deferred()
      const get = vi.spyOn(api, 'get').mockReturnValueOnce(opened.promise as never)
      const store = useThreadStore()
      const opening = store.open(5, 10)
      expect(store.replace(edited(12, 'live', 20))).toBe(false)
      opened.resolve(withRoot([13, 12], 'c1'))
      await opening
      expect(store.replies.find((m) => m.id === 12)?.body).toBe('live')
      store.replace(edited(13, 'live 13', 21))
      get.mockResolvedValueOnce(withRoot([13, 12, 11], null) as never)
      await store.loadOlder()
      get.mockResolvedValueOnce(withRoot([13, 12, 11], null) as never)
      await store.catchUp()
      expect(store.replies.map((m) => m.body)).toEqual(['r11', 'live', 'live 13'])
    })

    it('takes a newer edit from the server', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValue(withRoot([12, 11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      store.replace(edited(12, 'live', 20))
      get.mockResolvedValueOnce({ data: [edited(12, 'server', 40), reply(11)], meta: { next_cursor: null, root: root() } } as never)
      await store.catchUp()
      expect(store.replies.find((m) => m.id === 12)?.body).toBe('server')
    })

    it('removes a deleted reply in live and lowers the root counters from the event', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(withRoot([13, 12, 11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      expect(store.remove(deleted(13, 10, { replies_count: 2, last_reply_at: '2026-01-01T00:00:12Z' }))).toBe(true)
      expect(ids(store.replies)).toEqual([11, 12])
      expect(store.root).toMatchObject({ replies_count: 2, last_reply_at: '2026-01-01T00:00:12Z', deleted_at: null })
      expect(store.insert(reply(13))).toBe(false)
      expect(store.replace(edited(13, 'late edit', 40))).toBe(false)
      expect(store.root?.replies_count).toBe(2)
    })

    it('ignores deletions of other threads or channels', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(withRoot([12, 11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      expect(store.remove({ ...deleted(41, 40, { replies_count: 0, last_reply_at: null }), root: { id: 40, replies_count: 0, last_reply_at: null } })).toBe(false)
      expect(store.remove({ ...deleted(12, 10, { replies_count: 1, last_reply_at: null }), channel_id: 6 })).toBe(false)
      expect(ids(store.replies)).toEqual([11, 12])
      expect(store.root?.replies_count).toBe(3)
    })

    it('re-adds live replies created after the deletion on top of the event counters', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(withRoot([13, 12, 11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      store.insert({ ...reply(14), created_at: at(40) })
      expect(store.root?.replies_count).toBe(4)
      store.remove(deleted(12, 10, { replies_count: 2, last_reply_at: '2026-01-01T00:00:13Z' }, 30))
      expect(store.root).toMatchObject({ replies_count: 3, last_reply_at: at(40) })
    })

    it('keeps the event counters over a page that started before the deletion', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(withRoot([13, 12, 11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      const late = deferred()
      get.mockReturnValueOnce(late.promise as never)
      const catching = store.catchUp()
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2))
      store.remove(deleted(13, 10, { replies_count: 2, last_reply_at: '2026-01-01T00:00:12Z' }))
      late.resolve(withRoot([13, 12, 11], null))
      await catching
      expect(ids(store.replies)).toEqual([11, 12])
      expect(store.root?.replies_count).toBe(2)
    })

    it('applies a deletion that arrives while the thread is loading', async () => {
      const opened = deferred()
      vi.spyOn(api, 'get').mockReturnValueOnce(opened.promise as never)
      const store = useThreadStore()
      const opening = store.open(5, 10)
      expect(store.remove(deleted(13, 10, { replies_count: 2, last_reply_at: '2026-01-01T00:00:12Z' }))).toBe(true)
      opened.resolve(withRoot([13, 12, 11], null))
      await opening
      expect(ids(store.replies)).toEqual([11, 12])
      expect(store.root?.replies_count).toBe(2)
    })

    it('turns the deleted root into a marker, also without replies, and ignores later edits of it', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(withRoot([11], null, { replies_count: 1, last_reply_at: '2026-01-01T00:00:11Z' }) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      expect(store.remove(deleted(10, null, { replies_count: 1, last_reply_at: '2026-01-01T00:00:11Z' }))).toBe(true)
      expect(store.root).toMatchObject({ id: 10, body: null, deleted_at: at(30), replies_count: 1 })
      expect(ids(store.replies)).toEqual([11])
      expect(store.replace(edited(10, 'late', 40, null))).toBe(false)
      store.remove(deleted(11, 10, { replies_count: 0, last_reply_at: null }, 31))
      expect(store.replies).toEqual([])
      expect(store.root).toMatchObject({ deleted_at: at(30), replies_count: 0, last_reply_at: null })
    })

    it('keeps the root deleted when a page fetched before the deletion arrives', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(withRoot([11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      const late = deferred()
      get.mockReturnValueOnce(late.promise as never)
      const catching = store.catchUp()
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2))
      store.remove(deleted(10, null, { replies_count: 1, last_reply_at: '2026-01-01T00:00:11Z' }))
      late.resolve(withRoot([11], null))
      await catching
      expect(store.root).toMatchObject({ body: null, deleted_at: at(30), replies_count: 1 })
    })

    it('drops in catchUp the loaded replies missing from the covered range and lowers the root counters', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(withRoot([14, 13, 12, 11], null, { replies_count: 4 }) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      get.mockResolvedValueOnce(withRoot([15, 14, 11], null, { replies_count: 3, last_reply_at: '2026-01-01T00:00:15Z' }) as never)
      await store.catchUp()
      expect(ids(store.replies)).toEqual([11, 14, 15])
      expect(store.root?.replies_count).toBe(3)
      expect(store.insert(reply(12))).toBe(false)
    })

    it('only drops in catchUp what the pages cover when the cursor stops before the oldest loaded reply', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(withRoot([14, 13, 12, 11], 'old') as never)
      const store = useThreadStore()
      await store.open(5, 10)
      get.mockResolvedValueOnce(withRoot([16, 14, 12], 'c1') as never)
      await store.catchUp()
      expect(ids(store.replies)).toEqual([11, 12, 14, 16])
    })

    it('drops gone replies when catchUp resets to the newest page', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(withRoot([201, 200], 'old') as never)
      const store = useThreadStore()
      await store.open(5, 10)
      get.mockResolvedValueOnce(withRoot([202, 200, 199], 'newest') as never)
      get.mockResolvedValue(withRoot([1000], 'more') as never)
      await store.catchUp()
      expect(ids(store.replies)).toEqual([199, 200, 202])
    })

    it('keeps a reply inserted live while catchUp is in flight', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(withRoot([12, 11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      const late = deferred()
      get.mockReturnValueOnce(late.promise as never)
      const catching = store.catchUp()
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2))
      store.insert(reply(13))
      late.resolve(withRoot([12, 11], null))
      await catching
      expect(ids(store.replies)).toEqual([11, 12, 13])
    })

    it('forgets deletions and edits on clear', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(withRoot([12, 11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      store.remove(deleted(12, 10, { replies_count: 1, last_reply_at: '2026-01-01T00:00:11Z' }))
      store.replace(edited(11, 'live', 20))
      await store.open(5, 10)
      expect(ids(store.replies)).toEqual([11, 12])
      expect(store.replies[0].body).toBe('r11')
      expect(store.root?.replies_count).toBe(3)
    })
  })

  describe('draft', () => {
    const draft = { text: 'hola', mentions: [{ id: 3, name: 'Ana', start: 0, end: 4 }] }

    it('keeps the draft when the same root is reopened and drops it for another root', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      store.setDraft(draft)
      expect(store.draft).toEqual({ rootId: 10, ...draft })
      await store.open(5, 10)
      expect(store.draft).toEqual({ rootId: 10, ...draft })
      await store.open(5, 11)
      expect(store.draft).toBeNull()
    })

    it('clears the draft with clear', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      store.setDraft(draft)
      store.clear()
      expect(store.draft).toBeNull()
    })

    it('ignores setDraft without an open thread', () => {
      const store = useThreadStore()
      store.setDraft(draft)
      expect(store.draft).toBeNull()
    })

    it('stores null for an empty or null draft', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([11], null) as never)
      const store = useThreadStore()
      await store.open(5, 10)
      store.setDraft(draft)
      store.setDraft({ text: '', mentions: [] })
      expect(store.draft).toBeNull()
      store.setDraft(draft)
      store.setDraft(null)
      expect(store.draft).toBeNull()
    })

    it('still discards a load in flight from a previous generation while keeping the draft', async () => {
      const first = deferred()
      const second = deferred()
      vi.spyOn(api, 'get')
        .mockReturnValueOnce(first.promise as never)
        .mockReturnValueOnce(second.promise as never)
      const store = useThreadStore()
      const stale = store.open(5, 10)
      store.setDraft(draft)
      const fresh = store.open(5, 10)
      expect(store.draft).toEqual({ rootId: 10, ...draft })
      first.resolve(page([99], 'old'))
      await stale
      expect(store.replies).toEqual([])
      expect(store.nextCursor).toBeNull()
      expect(store.loading).toBe(true)
      second.resolve(page([12, 11], null))
      await fresh
      expect(ids(store.replies)).toEqual([11, 12])
      expect(store.draft).toEqual({ rootId: 10, ...draft })
    })
  })
})
