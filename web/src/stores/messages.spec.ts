import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, watch } from 'vue'
import { api, ApiError } from '../api/client'
import type { Message, MessageDeletedEvent, MessagePayload } from '../api/types'
import { resetGroupStatuses, setGroupStatus, statusOfGroup } from '../composables/useLogGroupStatuses'
import { CATCH_UP_MAX_PAGES, useMessagesStore } from './messages'

const message = (id: number, channel_id = 5): Message => ({
  id,
  channel_id,
  kind: 'user',
  body: `m${id}`,
  payload: null,
  log_group_id: null,
  parent_id: null,
  replies_count: 0,
  recent_participants: [],
  last_reply_at: null,
  mentions: [],
  attachments: [],
  user: { id: 1, name: 'Ana' },
  created_at: '2026-01-01T00:00:00Z',
  edited_at: null,
  deleted_at: null,
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

  it('sends attachment ids, with an empty body', async () => {
    const store = useMessagesStore()
    vi.spyOn(api, 'get').mockResolvedValueOnce(page([1], null) as never)
    await store.open(5)
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce({ data: message(2) } as never)
    await store.send('', [4, 5])
    expect(post).toHaveBeenCalledWith('/api/channels/5/messages', { body: '', attachment_ids: [4, 5] })
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
      resolve(page([4, 3, 2, 1], null))
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

  describe('threads', () => {
    const reply = (id: number, parent: number, at = '2026-01-02T00:00:00Z'): Message => ({
      ...message(id),
      parent_id: parent,
      created_at: at,
    })
    const root = (id: number, replies_count: number, last_reply_at: string | null = null): Message => ({
      ...message(id),
      replies_count,
      last_reply_at,
    })

    it('does not add a live reply to the list but bumps the counter and last_reply_at of its root', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [root(2, 1, '2026-01-01T00:00:00Z'), message(1)], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      expect(store.insert(reply(9, 2))).toBe(true)
      expect(store.messages.map((m) => m.id)).toEqual([1, 2])
      expect(store.messages[1].replies_count).toBe(2)
      expect(store.messages[1].last_reply_at).toBe('2026-01-02T00:00:00Z')
      expect(store.messages[0].replies_count).toBe(0)
    })

    it('puts the author of a live reply first among the root participants, once and capped at three', async () => {
      const person = (id: number) => ({ id, name: `U${id}` })
      const seeded = { ...root(2, 3), recent_participants: [person(1), person(2), person(3)] }
      vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [seeded], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      store.insert({ ...reply(9, 2), user: person(3) })
      expect(store.messages[0].recent_participants.map((u) => u.id)).toEqual([3, 1, 2])
      store.insert({ ...reply(10, 2), user: person(4) })
      expect(store.messages[0].recent_participants.map((u) => u.id)).toEqual([4, 3, 1])
      store.insert({ ...reply(11, 2), user: null })
      expect(store.messages[0].recent_participants.map((u) => u.id)).toEqual([4, 3, 1])
    })

    it('counts a repeated reply once and keeps the newest last_reply_at', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [root(2, 0)], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      store.insert(reply(9, 2, '2026-01-03T00:00:00Z'))
      expect(store.insert(reply(9, 2, '2026-01-03T00:00:00Z'))).toBe(false)
      store.insert(reply(8, 2, '2026-01-02T00:00:00Z'))
      expect(store.messages[0].replies_count).toBe(2)
      expect(store.messages[0].last_reply_at).toBe('2026-01-03T00:00:00Z')
    })

    it('updates a root still queued in the same tick', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [message(1)], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      store.insert(message(3))
      store.insert(reply(9, 3))
      await nextTick()
      expect(store.messages.map((m) => m.id)).toEqual([1, 3])
      expect(store.messages[1].replies_count).toBe(1)
    })

    it('ignores a reply whose root is not loaded or of another channel', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [root(2, 0)], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      store.insert(reply(9, 1))
      store.insert({ ...reply(10, 2), channel_id: 6 })
      expect(store.messages.map((m) => m.id)).toEqual([2])
      expect(store.messages[0].replies_count).toBe(0)
    })

    it('ignores a reply without an open channel', () => {
      const store = useMessagesStore()
      expect(store.channelId).toBeNull()
      expect(store.insert(reply(9, 2))).toBe(false)
      expect(store.messages).toEqual([])
    })

    it('forgets counted replies on clear', async () => {
      vi.spyOn(api, 'get').mockResolvedValue({ data: [root(2, 0)], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      store.insert(reply(9, 2))
      await store.open(5)
      store.insert(reply(9, 2))
      expect(store.messages[0].replies_count).toBe(1)
    })

    it('catchUp refreshes the counters of loaded roots when it joins', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [root(2, 0), message(1)], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      get.mockResolvedValueOnce({ data: [message(4), root(2, 3, '2026-01-05T00:00:00Z'), message(1)], meta: { next_cursor: null } } as never)
      await store.catchUp()
      expect(store.messages.map((m) => m.id)).toEqual([1, 2, 4])
      expect(store.messages[1].replies_count).toBe(3)
      expect(store.messages[1].last_reply_at).toBe('2026-01-05T00:00:00Z')
    })

    it('catchUp reset takes the counters from the newest page', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [message(2)], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      get.mockResolvedValueOnce({ data: [root(120, 4), message(119)], meta: { next_cursor: 'newest' } } as never)
      get.mockResolvedValue(page([100], 'more') as never)
      await store.catchUp()
      expect(store.messages.find((m) => m.id === 120)?.replies_count).toBe(4)
    })

    it('catchUp keeps the +1 of a live reply that the fetched snapshot does not include yet', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [root(2, 0)], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      let resolve: (value: unknown) => void = () => {}
      get.mockReturnValueOnce(new Promise((done) => (resolve = done)) as never)
      const pending = store.catchUp()
      store.insert(reply(9, 2))
      expect(store.messages[0].replies_count).toBe(1)
      resolve({ data: [root(2, 0)], meta: { next_cursor: null } })
      await pending
      expect(store.messages[0].replies_count).toBe(1)
      expect(store.messages[0].last_reply_at).toBe('2026-01-02T00:00:00Z')
    })

    it('catchUp does not count twice a live reply that arrives after a snapshot that already includes it', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [root(2, 0)], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      get.mockResolvedValueOnce({ data: [root(2, 1, '2026-01-02T00:00:00Z')], meta: { next_cursor: null } } as never)
      await store.catchUp()
      expect(store.insert(reply(9, 2))).toBe(true)
      expect(store.messages[0].replies_count).toBe(1)
      store.insert(reply(10, 2, '2026-01-03T00:00:00Z'))
      expect(store.messages[0].replies_count).toBe(2)
    })

    it('loadOlder and open keep the counters of the page they load', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [message(4)], meta: { next_cursor: 'c1' } } as never)
      const store = useMessagesStore()
      await store.open(5)
      get.mockResolvedValueOnce({ data: [root(2, 7), message(1)], meta: { next_cursor: null } } as never)
      await store.loadOlder()
      expect(store.messages.find((m) => m.id === 2)?.replies_count).toBe(7)
    })
  })

  describe('edits and deletions', () => {
    const reply = (id: number, parent: number, at = '2026-01-02T00:00:00Z'): Message => ({ ...message(id), parent_id: parent, created_at: at })
    const root = (id: number, replies_count: number, last_reply_at: string | null = null): Message => ({ ...message(id), replies_count, last_reply_at })
    const deleted = (id: number, parent_id: number | null, counters: [number, number, string | null], at = '2026-01-04T00:00:00Z'): MessageDeletedEvent => ({
      id,
      channel_id: 5,
      parent_id,
      deleted_at: at,
      root: { id: counters[0], replies_count: counters[1], last_reply_at: counters[2] },
    })
    const edited = (id: number, body: string, at = '2026-01-03T00:00:00Z'): Message => ({ ...message(id), body, edited_at: at })

    it('replaces an edited root in the list keeping its live counters, and ignores older edits', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [root(2, 1, '2026-01-01T00:00:00Z'), message(1)], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      store.insert(reply(9, 2))
      expect(store.replace({ ...edited(2, 'new'), replies_count: 0 })).toBe(true)
      expect(store.messages[1].body).toBe('new')
      expect(store.messages[1].edited_at).toBe('2026-01-03T00:00:00Z')
      expect(store.messages[1].replies_count).toBe(2)
      expect(store.replace(edited(2, 'old', '2026-01-02T00:00:00Z'))).toBe(false)
      expect(store.messages[1].body).toBe('new')
    })

    it('replaces an edited root still queued', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce(page([1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      store.insert(message(3))
      expect(store.replace(edited(3, 'new'))).toBe(true)
      await nextTick()
      expect(store.messages.map((m) => m.body)).toEqual(['m1', 'new'])
    })

    it('does not insert an edit or a deletion of a message that is not loaded', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce(page([1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      expect(store.replace(edited(7, 'x'))).toBe(false)
      expect(store.replace({ ...edited(8, 'x'), parent_id: 1 })).toBe(false)
      expect(store.replace({ ...edited(1, 'x'), channel_id: 6 })).toBe(false)
      expect(store.remove(deleted(7, null, [7, 2, '2026-01-02T00:00:00Z']))).toBe(false)
      await nextTick()
      expect(store.messages.map((m) => m.id)).toEqual([1])
      expect(store.messages[0].body).toBe('m1')
    })

    it('removes a deleted root without replies, from the list and from the queue', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce(page([2, 1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      store.insert(message(3))
      expect(store.remove(deleted(3, null, [3, 0, null]))).toBe(true)
      expect(store.remove(deleted(1, null, [1, 0, null]))).toBe(true)
      await nextTick()
      expect(store.messages.map((m) => m.id)).toEqual([2])
      expect(store.insert(message(1))).toBe(false)
      expect(store.replace(edited(1, 'x'))).toBe(false)
      await nextTick()
      expect(store.messages.map((m) => m.id)).toEqual([2])
    })

    it('leaves a marker for a deleted root with replies and ignores later edits of it', async () => {
      const full = { ...root(2, 2, '2026-01-02T00:00:00Z'), attachments: [{ id: 1 }], mentions: [{ id: 3, name: 'Eva' }] } as unknown as Message
      vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [full], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      store.remove(deleted(2, null, [2, 2, '2026-01-02T00:00:00Z']))
      expect(store.messages[0]).toMatchObject({ id: 2, body: null, mentions: [], attachments: [], deleted_at: '2026-01-04T00:00:00Z', replies_count: 2 })
      expect(store.replace(edited(2, 'back', '2026-01-05T00:00:00Z'))).toBe(false)
      expect(store.messages[0].body).toBeNull()
    })

    it('lowers the root counters when a reply is deleted, and drops a deleted root left without replies', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [root(2, 2, '2026-01-03T00:00:00Z'), root(3, 1, '2026-01-02T00:00:00Z')], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      expect(store.remove(deleted(9, 2, [2, 1, '2026-01-02T00:00:00Z']))).toBe(true)
      expect(store.messages[0]).toMatchObject({ replies_count: 1, last_reply_at: '2026-01-02T00:00:00Z' })
      store.remove(deleted(3, null, [3, 1, '2026-01-02T00:00:00Z']))
      store.remove(deleted(10, 3, [3, 0, null], '2026-01-05T00:00:00Z'))
      expect(store.messages.map((m) => m.id)).toEqual([2])
    })

    it('keeps the counters of a newer deletion when an older deletion of the same root arrives late', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [root(2, 3, '2026-01-03T00:00:00Z')], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      store.remove(deleted(9, 2, [2, 1, '2026-01-01T00:00:00Z'], '2026-01-06T00:00:00Z'))
      store.remove(deleted(8, 2, [2, 2, '2026-01-02T00:00:00Z'], '2026-01-04T00:00:00Z'))
      expect(store.messages[0]).toMatchObject({ replies_count: 1, last_reply_at: '2026-01-01T00:00:00Z' })
    })

    it('does not count again a deleted reply whose created event arrives late', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [root(2, 1, '2026-01-01T00:00:00Z')], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      store.insert(reply(9, 2))
      expect(store.messages[0].replies_count).toBe(2)
      store.remove(deleted(9, 2, [2, 1, '2026-01-01T00:00:00Z']))
      expect(store.messages[0].replies_count).toBe(1)
      expect(store.insert(reply(9, 2))).toBe(false)
      expect(store.messages[0].replies_count).toBe(1)
    })

    it('keeps a live reply created after the deletion, whichever event arrives first', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [root(2, 2, '2026-01-02T00:00:00Z')], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      store.insert(reply(11, 2, '2026-01-06T00:00:00Z'))
      expect(store.messages[0].replies_count).toBe(3)
      store.remove(deleted(8, 2, [2, 1, '2026-01-01T00:00:00Z']))
      expect(store.messages[0]).toMatchObject({ replies_count: 2, last_reply_at: '2026-01-06T00:00:00Z' })
      expect(store.insert(reply(7, 2, '2026-01-03T00:00:00Z'))).toBe(true)
      expect(store.messages[0].replies_count).toBe(2)
      store.insert(reply(12, 2, '2026-01-07T00:00:00Z'))
      expect(store.messages[0]).toMatchObject({ replies_count: 3, last_reply_at: '2026-01-07T00:00:00Z' })
    })

    it('catchUp does not raise the counters again with a snapshot older than a live deletion', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [root(2, 2, '2026-01-02T00:00:00Z'), root(3, 0)], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      store.insert(reply(9, 2, '2026-01-03T00:00:00Z'))
      let resolve: (value: unknown) => void = () => {}
      get.mockReturnValueOnce(new Promise((done) => (resolve = done)) as never)
      const pending = store.catchUp()
      store.remove(deleted(9, 2, [2, 2, '2026-01-02T00:00:00Z']))
      store.remove(deleted(3, null, [3, 0, null]))
      resolve({ data: [root(3, 0), root(2, 3, '2026-01-03T00:00:00Z')], meta: { next_cursor: null } })
      await pending
      expect(store.messages.map((m) => m.id)).toEqual([2])
      expect(store.messages[0]).toMatchObject({ replies_count: 2, last_reply_at: '2026-01-02T00:00:00Z' })
      store.insert(reply(12, 2, '2026-01-07T00:00:00Z'))
      expect(store.messages[0].replies_count).toBe(3)
    })

    it('catchUp after a deletion takes the newer snapshot without counting the deleted reply', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ data: [root(2, 1, '2026-01-02T00:00:00Z')], meta: { next_cursor: null } } as never)
      const store = useMessagesStore()
      await store.open(5)
      store.insert(reply(9, 2, '2026-01-03T00:00:00Z'))
      store.remove(deleted(9, 2, [2, 1, '2026-01-02T00:00:00Z']))
      get.mockResolvedValueOnce({ data: [root(2, 1, '2026-01-02T00:00:00Z')], meta: { next_cursor: null } } as never)
      await store.catchUp()
      expect(store.messages[0].replies_count).toBe(1)
    })

    it('loadOlder and open drop a root deleted while they load', async () => {
      const get = vi.spyOn(api, 'get')
      let resolve: (value: unknown) => void = () => {}
      get.mockReturnValueOnce(new Promise((done) => (resolve = done)) as never)
      const store = useMessagesStore()
      const opening = store.open(5)
      store.remove(deleted(4, null, [4, 0, null]))
      resolve(page([5, 4], 'c1'))
      await opening
      expect(store.messages.map((m) => m.id)).toEqual([5])
      get.mockReturnValueOnce(new Promise((done) => (resolve = done)) as never)
      const older = store.loadOlder()
      store.remove(deleted(2, null, [2, 1, '2026-01-02T00:00:00Z']))
      resolve({ data: [root(2, 1, '2026-01-02T00:00:00Z'), message(1)], meta: { next_cursor: null } })
      await older
      expect(store.messages.map((m) => [m.id, m.deleted_at])).toEqual([[1, null], [2, '2026-01-04T00:00:00Z'], [5, null]])
    })

    it('catchUp removes loaded roots inside the covered range that no longer come, keeping newer and live ones', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([6, 5, 4, 3, 2, 1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      let resolve: (value: unknown) => void = () => {}
      get.mockReturnValueOnce(new Promise((done) => (resolve = done)) as never)
      const pending = store.catchUp()
      store.insert(message(9))
      resolve(page([7, 6, 4, 3], 'c1'))
      await pending
      expect(store.messages.map((m) => m.id)).toEqual([1, 2, 3, 4, 6, 7, 9])
    })

    it('catchUp keeps loaded roots older than the range when the last page has a cursor', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([6, 5, 1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      get.mockResolvedValueOnce(page([6, 3], 'c1') as never)
      await store.catchUp()
      expect(store.messages.map((m) => m.id)).toEqual([1, 3, 6])
    })

    it('catchUp does not revert an edit applied in live with an older snapshot', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([2, 1], null) as never)
      const store = useMessagesStore()
      await store.open(5)
      let resolve: (value: unknown) => void = () => {}
      get.mockReturnValueOnce(new Promise((done) => (resolve = done)) as never)
      const pending = store.catchUp()
      store.replace({ ...message(1), body: 'new', edited_at: '2026-01-03T00:00:00Z' })
      resolve(page([2, 1], null))
      await pending
      expect(store.messages[0]).toMatchObject({ body: 'new', edited_at: '2026-01-03T00:00:00Z' })
      get.mockResolvedValueOnce({ data: [{ ...message(1), body: 'newer', edited_at: '2026-01-04T00:00:00Z' }], meta: { next_cursor: null } } as never)
      await store.catchUp()
      expect(store.messages[0].body).toBe('newer')
    })
  })
})
