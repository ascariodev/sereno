import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, watch } from 'vue'
import { api, ApiError } from '../api/client'
import type { Message, MessagePayload } from '../api/types'
import { resetGroupStatuses, setGroupStatus, statusOfGroup } from '../composables/useLogGroupStatuses'
import { CATCH_UP_MAX_PAGES, useMessagesStore } from './messages'

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
    resetGroupStatuses()
  })

  it('records a status_changed that arrives while the channel is loading', async () => {
    let resolve: (value: unknown) => void = () => {}
    vi.spyOn(api, 'get').mockReturnValue(new Promise((done) => (resolve = done)) as never)
    const store = useMessagesStore()
    const opening = store.open(5)
    expect(store.loading).toBe(true)
    const payload = { type: 'log.group_status_changed', log_group_id: 9, status: 'resolved', previous_status: 'open' }
    store.insert({ ...message(7), kind: 'system', payload: payload as MessagePayload })
    expect(statusOfGroup(9)).toBe('resolved')
    resolve(page([1], null))
    await opening
    expect(statusOfGroup(9)).toBe('resolved')
    store.clear()
    expect(statusOfGroup(9)).toBeUndefined()
  })

  const statusMessage = (id: number, status: string): Message => ({
    ...message(id),
    kind: 'system',
    payload: { type: 'log.group_status_changed', log_group_id: 9, status, previous_status: 'open' } as MessagePayload,
  })

  it('feeds the status map from the history pages, newest wins', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ data: [statusMessage(8, 'open'), statusMessage(6, 'ignored')], meta: { next_cursor: 'c' } } as never)
      .mockResolvedValueOnce({ data: [statusMessage(3, 'resolved')], meta: { next_cursor: null } } as never)
    const store = useMessagesStore()
    await store.open(5)
    expect(statusOfGroup(9)).toBe('open')
    await store.loadOlder()
    expect(get).toHaveBeenCalledTimes(2)
    expect(statusOfGroup(9)).toBe('open')
  })

  it('ignores a late older status_changed after a local action', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([10], null) as never)
    const store = useMessagesStore()
    await store.open(5)
    setGroupStatus(9, 'resolved')
    store.insert(statusMessage(7, 'ignored'))
    expect(statusOfGroup(9)).toBe('resolved')
    store.insert(statusMessage(11, 'open'))
    expect(statusOfGroup(9)).toBe('open')
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
    await nextTick()
    expect(store.messages.map((m) => m.id)).toEqual([2, 3, 4, 5])
  })

  it('groups a burst of inserts in the same tick into a single update', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([1, 100, 400], null) as never)
    const store = useMessagesStore()
    await store.open(5)
    let updates = 0
    watch(
      () => store.messages,
      () => updates++,
      { flush: 'sync' },
    )
    const ids = Array.from({ length: 200 }, (_, index) => ((index * 37) % 200) * 2 + 3)
    const accepted = ids.map((id) => store.insert(message(id)))
    expect(accepted.every(Boolean)).toBe(true)
    expect(store.insert(message(ids[0]))).toBe(false)
    expect(store.insert(message(100))).toBe(false)
    expect(updates).toBe(0)
    await nextTick()
    expect(updates).toBe(1)
    const result = store.messages.map((m) => m.id)
    expect(result).toHaveLength(203)
    expect(new Set(result).size).toBe(result.length)
    expect(result).toEqual([...result].sort((a, b) => a - b))
    expect(result[0]).toBe(1)
    expect(result).toContain(400)
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

  it('discards a pending send when the store is cleared or reopened', async () => {
    const store = useMessagesStore()
    vi.spyOn(api, 'get').mockResolvedValue(page([1], null) as never)
    await store.open(5)

    let resolve: (value: unknown) => void = () => {}
    vi.spyOn(api, 'post').mockReturnValueOnce(new Promise((r) => (resolve = r)) as never)
    const cleared = store.send('hi')
    store.clear()
    resolve({ data: message(2) })
    await cleared
    expect(store.messages).toEqual([])

    await store.open(5)
    vi.spyOn(api, 'post').mockReturnValueOnce(new Promise((r) => (resolve = r)) as never)
    const reopened = store.send('hi')
    await store.open(5)
    resolve({ data: message(3) })
    await reopened
    expect(store.messages.map((m) => m.id)).toEqual([1])
  })

  it('does not duplicate a queued id that also arrives in the open page', async () => {
    const store = useMessagesStore()
    let resolve: (value: unknown) => void = () => {}
    vi.spyOn(api, 'get').mockReturnValueOnce(new Promise((r) => (resolve = r)) as never)
    const opening = store.open(5)
    expect(store.insert(message(3))).toBe(true)
    expect(store.messages).toEqual([])
    resolve(page([3, 2, 1], null))
    await opening
    expect(store.messages.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('does not duplicate a queued id that also arrives in the loadOlder page', async () => {
    const store = useMessagesStore()
    vi.spyOn(api, 'get').mockResolvedValueOnce(page([5, 4], 'c1') as never)
    await store.open(5)
    let resolve: (value: unknown) => void = () => {}
    vi.spyOn(api, 'get').mockReturnValueOnce(new Promise((r) => (resolve = r)) as never)
    const older = store.loadOlder()
    expect(store.insert(message(3))).toBe(true)
    expect(store.messages.map((m) => m.id)).toEqual([4, 5])
    resolve(page([3, 2], null))
    await older
    expect(store.messages.map((m) => m.id)).toEqual([2, 3, 4, 5])
  })

  it('does not duplicate a queued id that also arrives in the send response', async () => {
    const store = useMessagesStore()
    vi.spyOn(api, 'get').mockResolvedValueOnce(page([1], null) as never)
    await store.open(5)
    vi.spyOn(api, 'post').mockResolvedValueOnce({ data: message(2) } as never)
    expect(store.insert(message(2))).toBe(true)
    expect(store.messages.map((m) => m.id)).toEqual([1])
    await store.send('hi')
    expect(store.messages.map((m) => m.id)).toEqual([1, 2])
  })

  it('schedules a new flush after clear with an insert still queued', async () => {
    const store = useMessagesStore()
    vi.spyOn(api, 'get').mockResolvedValue(page([1], null) as never)
    await store.open(5)
    expect(store.insert(message(2))).toBe(true)
    store.clear()
    await store.open(5)
    expect(store.insert(message(3))).toBe(true)
    await nextTick()
    expect(store.messages.map((m) => m.id)).toEqual([1, 3])
  })

  describe('catchUp', () => {
    it('inserts new messages from a single page', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([2, 1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      get.mockResolvedValueOnce(page([4, 3, 2], 'c1') as never)
      await store.catchUp()
      expect(get).toHaveBeenCalledTimes(2)
      expect(store.messages.map((m) => m.id)).toEqual([1, 2, 3, 4])
    })

    it('follows the cursor until it joins the loaded messages', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([2, 1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      get.mockResolvedValueOnce(page([8, 7, 6], 'c1') as never)
        .mockResolvedValueOnce(page([5, 4, 3], 'c2') as never)
        .mockResolvedValueOnce(page([2, 1], null) as never)
      await store.catchUp()
      expect(get).toHaveBeenCalledTimes(4)
      expect(get).toHaveBeenLastCalledWith('/api/channels/5/messages', { query: { per_page: 50, cursor: 'c2' } })
      expect(store.messages.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    })

    it('resets to the newest page when the cap is reached without joining', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([2, 1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      get.mockResolvedValueOnce(page([120, 119], 'newest') as never)
      get.mockResolvedValue(page([100], 'more') as never)
      await store.catchUp()
      expect(get).toHaveBeenCalledTimes(1 + CATCH_UP_MAX_PAGES)
      expect(store.messages.map((m) => m.id)).toEqual([119, 120])
      expect(store.nextCursor).toBe('newest')
    })

    it('feeds the status map from the newest page when it cannot join', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([2, 1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      get.mockResolvedValueOnce({ data: [statusMessage(120, 'resolved')], meta: { next_cursor: 'newest' } } as never)
      get.mockResolvedValue(page([100], 'more') as never)
      await store.catchUp()
      expect(statusOfGroup(9)).toBe('resolved')
    })

    it('keeps the reset list when a pending loadOlder resolves afterwards', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([4, 3], 'old') as never)
      const store = useMessagesStore()
      await store.open(5)
      let resolve: (value: unknown) => void = () => {}
      get.mockReturnValueOnce(new Promise((r) => (resolve = r)) as never)
      const older = store.loadOlder()
      get.mockResolvedValueOnce(page([120, 119], 'newest') as never)
      get.mockResolvedValue(page([100], 'more') as never)
      await store.catchUp()
      expect(store.loadingMore).toBe(false)
      resolve(page([2, 1], null))
      await older
      expect(store.messages.map((m) => m.id)).toEqual([119, 120])
      expect(store.nextCursor).toBe('newest')
      expect(store.loadingMore).toBe(false)
    })

    it('keeps a realtime message newer than the newest page on reset', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([2, 1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      let resolve: (value: unknown) => void = () => {}
      get.mockReturnValueOnce(new Promise((r) => (resolve = r)) as never)
      const pending = store.catchUp()
      store.insert(message(130))
      get.mockResolvedValue(page([120, 119], 'newest') as never)
      resolve(page([120, 119], 'newest'))
      await pending
      expect(store.messages.map((m) => m.id)).toEqual([119, 120, 130])
    })

    it('does not duplicate a message that arrives in realtime during catchUp', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([2, 1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      let resolve: (value: unknown) => void = () => {}
      get.mockReturnValueOnce(new Promise((r) => (resolve = r)) as never)
      const pending = store.catchUp()
      store.insert(message(3))
      resolve(page([4, 3, 2], null))
      await pending
      expect(store.messages.map((m) => m.id)).toEqual([1, 2, 3, 4])
    })

    it('discards a pending catchUp when the same channel is reopened', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([2, 1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      let resolve: (value: unknown) => void = () => {}
      get.mockReturnValueOnce(new Promise((r) => (resolve = r)) as never)
      const pending = store.catchUp()
      get.mockResolvedValueOnce(page([2, 1], null) as never)
      await store.open(5)
      resolve(page([9, 8], null))
      await pending
      expect(store.messages.map((m) => m.id)).toEqual([1, 2])
    })

    it('does nothing when there are no new messages', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([2, 1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      get.mockResolvedValueOnce(page([2, 1], null) as never)
      await store.catchUp()
      expect(store.messages.map((m) => m.id)).toEqual([1, 2])
    })

    it('discards the result after clear or a channel change', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([2, 1], null) as never)
      const store = useMessagesStore()
      await store.open(5)

      let resolve: (value: unknown) => void = () => {}
      get.mockReturnValueOnce(new Promise((r) => (resolve = r)) as never)
      const cleared = store.catchUp()
      store.clear()
      resolve(page([4, 3], 'c1'))
      await cleared
      expect(store.messages).toEqual([])
      expect(get).toHaveBeenCalledTimes(2)

      get.mockResolvedValueOnce(page([2, 1], null) as never)
      await store.open(5)
      get.mockReturnValueOnce(new Promise((r) => (resolve = r)) as never)
      const switched = store.catchUp()
      get.mockResolvedValueOnce({ data: [message(9, 6)], meta: { next_cursor: null } } as never)
      await store.open(6)
      resolve(page([4, 3], 'c1'))
      await switched
      expect(store.channelId).toBe(6)
      expect(store.messages.map((m) => m.id)).toEqual([9])
      expect(get).toHaveBeenCalledTimes(5)
    })
  })
})
