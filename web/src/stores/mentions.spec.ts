import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import * as mentionsApi from '../api/mentions'
import type { Mention, MentionPage, Message } from '../api/types'
import { disconnectRealtime, MENTION_CREATED_EVENT, MENTION_REMOVED_EVENT, setRealtimeClientFactory } from '../realtime/echo'
import { createFakeRealtimeClient } from '../test/fakeRealtimeClient'
import { useMentionsStore } from './mentions'
import { useOrganizationStore } from './organization'

const message = (id: number): Message => ({
  id,
  channel_id: 4,
  kind: 'user',
  body: `hi <@9>`,
  payload: null,
  log_group_id: null,
  parent_id: null,
  replies_count: 0,
  recent_participants: [],
  last_reply_at: null,
  user: { id: 2, name: 'Ana' },
  mentions: [],
  attachments: [],
  created_at: '2026-10-09T10:00:00Z',
  edited_at: null,
  deleted_at: null,
})

const mention = (id: number, read = false): Mention => ({
  id,
  read_at: read ? '2026-10-09T11:00:00Z' : null,
  created_at: '2026-10-09T10:00:00Z',
  message: message(id + 100),
  channel: { id: 4, name: 'general', project_id: 1 },
  parent_id: null,
})

const page = (data: Mention[], unread: number, next: string | null = null): MentionPage => ({
  data,
  meta: { next_cursor: next, unread_count: unread },
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(orgId: number | null = 1) {
  setActivePinia(createPinia())
  const organization = useOrganizationStore()
  organization.$patch({ activeId: orgId })
  return { organization, store: useMentionsStore() }
}

function live(orgId: number, id: number) {
  return { organization_id: orgId, channel_id: 4, parent_id: null, message: message(id) }
}

describe('mentions store', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => {
    disconnectRealtime()
    setRealtimeClientFactory(null)
  })

  describe('loading', () => {
    it('loads the first page with its unread count', async () => {
      const list = vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(3), mention(2, true)], 5, 'c1'))
      const { store } = setup()
      await store.refresh()
      expect(list.mock.calls[0][0]).toEqual({ perPage: mentionsApi.MENTIONS_PER_PAGE })
      expect(store.mentions.map((m) => m.id)).toEqual([3, 2])
      expect(store.unreadCount).toBe(5)
      expect(store.nextCursor).toBe('c1')
      expect(store.loaded).toBe(true)
      expect(store.loading).toBe(false)
    })

    it('does nothing without an active organization', async () => {
      const list = vi.spyOn(mentionsApi, 'listMentions')
      const { store } = setup(null)
      await store.refresh()
      expect(list).not.toHaveBeenCalled()
    })

    it('keeps the error and the previous data when a refresh fails', async () => {
      vi.spyOn(mentionsApi, 'listMentions').mockResolvedValueOnce(page([mention(1)], 1)).mockRejectedValueOnce(new ApiError(500, 'x'))
      const { store } = setup()
      await store.refresh()
      await store.refresh()
      expect(store.error?.status).toBe(500)
      expect(store.mentions).toHaveLength(1)
      expect(store.unreadCount).toBe(1)
    })

    it('paginates with the cursor, merges without duplicates and keeps newest first', async () => {
      const list = vi
        .spyOn(mentionsApi, 'listMentions')
        .mockResolvedValueOnce(page([mention(5), mention(4)], 3, 'c1'))
        .mockResolvedValueOnce(page([mention(4), mention(2)], 3, null))
      const { store } = setup()
      await store.refresh()
      await store.loadMore()
      expect(list.mock.calls[1][0]).toEqual({ cursor: 'c1', perPage: mentionsApi.MENTIONS_PER_PAGE })
      expect(store.mentions.map((m) => m.id)).toEqual([5, 4, 2])
      expect(store.nextCursor).toBeNull()
      await store.loadMore()
      expect(list).toHaveBeenCalledTimes(2)
    })

    it('flags a failed page without touching the first-load error and allows retrying', async () => {
      const list = vi
        .spyOn(mentionsApi, 'listMentions')
        .mockResolvedValueOnce(page([mention(5)], 1, 'c1'))
        .mockRejectedValueOnce(new ApiError(500, 'x'))
        .mockResolvedValueOnce(page([mention(2)], 1, null))
      const { store } = setup()
      await store.refresh()
      await store.loadMore()
      expect(store.loadMoreFailed).toBe(true)
      expect(store.error).toBeNull()
      expect(store.loadingMore).toBe(false)
      await store.loadMore()
      expect(store.loadMoreFailed).toBe(false)
      expect(store.mentions.map((m) => m.id)).toEqual([5, 2])
      expect(list).toHaveBeenCalledTimes(3)
    })

    it('updates unread_count from a later page only if nothing changed it meanwhile', async () => {
      const second = deferred<MentionPage>()
      vi.spyOn(mentionsApi, 'listMentions').mockResolvedValueOnce(page([mention(5)], 4, 'c1')).mockReturnValueOnce(second.promise)
      vi.spyOn(mentionsApi, 'markMentionsRead').mockResolvedValue(3)
      const { store } = setup()
      await store.refresh()
      const more = store.loadMore()
      await store.markRead(store.mentions[0])
      second.resolve(page([mention(2)], 4, null))
      await more
      expect(store.unreadCount).toBe(3)
      expect(store.mentions.map((m) => m.id)).toEqual([5, 2])
    })

    it('applies unread_count from a later page when nothing changed it', async () => {
      vi.spyOn(mentionsApi, 'listMentions')
        .mockResolvedValueOnce(page([mention(5)], 4, 'c1'))
        .mockResolvedValueOnce(page([mention(2)], 6, null))
      const { store } = setup()
      await store.refresh()
      await store.loadMore()
      expect(store.unreadCount).toBe(6)
    })

    it('a refresh merges into the loaded pages and keeps the cursor of the deepest page', async () => {
      vi.spyOn(mentionsApi, 'listMentions')
        .mockResolvedValueOnce(page([mention(5)], 2, 'c1'))
        .mockResolvedValueOnce(page([mention(3)], 2, null))
        .mockResolvedValueOnce(page([mention(6), mention(5)], 3, 'c-new'))
      const { store } = setup()
      await store.refresh()
      await store.loadMore()
      await store.refresh()
      expect(store.mentions.map((m) => m.id)).toEqual([6, 5, 3])
      expect(store.nextCursor).toBeNull()
      expect(store.unreadCount).toBe(3)
    })
  })

  describe('late responses', () => {
    it('discards a first page that arrives after the organization changed', async () => {
      const first = deferred<MentionPage>()
      vi.spyOn(mentionsApi, 'listMentions').mockReturnValueOnce(first.promise)
      const { organization, store } = setup()
      const pending = store.refresh()
      organization.$patch({ activeId: 2 })
      first.resolve(page([mention(1)], 9))
      await pending
      expect(store.mentions).toEqual([])
      expect(store.unreadCount).toBe(0)
      expect(store.loaded).toBe(false)
      expect(store.loading).toBe(false)
    })

    it('discards a first page that arrives after logout', async () => {
      const first = deferred<MentionPage>()
      vi.spyOn(mentionsApi, 'listMentions').mockReturnValueOnce(first.promise)
      const { organization, store } = setup()
      const pending = store.refresh()
      organization.clear()
      first.resolve(page([mention(1)], 9))
      await pending
      expect(store.mentions).toEqual([])
      expect(store.unreadCount).toBe(0)
    })

    it('discards a late error after a clear', async () => {
      const first = deferred<MentionPage>()
      vi.spyOn(mentionsApi, 'listMentions').mockReturnValueOnce(first.promise)
      const { organization, store } = setup()
      const pending = store.refresh()
      organization.clear()
      first.reject(new ApiError(500, 'x'))
      await pending
      expect(store.error).toBeNull()
    })

    it('lets only the newest refresh apply', async () => {
      const slow = deferred<MentionPage>()
      vi.spyOn(mentionsApi, 'listMentions').mockReturnValueOnce(slow.promise).mockResolvedValueOnce(page([mention(8)], 2))
      const { store } = setup()
      const first = store.refresh()
      await store.refresh()
      slow.resolve(page([mention(1)], 7))
      await first
      expect(store.mentions.map((m) => m.id)).toEqual([8])
      expect(store.unreadCount).toBe(2)
      expect(store.loading).toBe(false)
    })

    it('discards a later page that arrives after a clear', async () => {
      const more = deferred<MentionPage>()
      vi.spyOn(mentionsApi, 'listMentions').mockResolvedValueOnce(page([mention(5)], 1, 'c1')).mockReturnValueOnce(more.promise)
      const { organization, store } = setup()
      await store.refresh()
      const pending = store.loadMore()
      organization.clear()
      more.resolve(page([mention(2)], 1))
      await pending
      expect(store.mentions).toEqual([])
      expect(store.loadingMore).toBe(false)
    })

    it('a pagination in flight survives a refresh (the list is merged, not replaced)', async () => {
      const more = deferred<MentionPage>()
      vi.spyOn(mentionsApi, 'listMentions')
        .mockResolvedValueOnce(page([mention(5)], 1, 'c1'))
        .mockReturnValueOnce(more.promise)
        .mockResolvedValueOnce(page([mention(6), mention(5)], 2, 'cx'))
      const { store } = setup()
      await store.refresh()
      const pending = store.loadMore()
      await store.refresh()
      more.resolve(page([mention(2)], 2, null))
      await pending
      expect(store.mentions.map((m) => m.id)).toEqual([6, 5, 2])
      expect(store.nextCursor).toBeNull()
    })
  })

  describe('marking read', () => {
    async function loaded() {
      vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(3), mention(2), mention(1, true)], 2))
      const ctx = setup()
      await ctx.store.refresh()
      return ctx
    }

    it('marks one optimistically and takes the count from the API', async () => {
      const { store } = await loaded()
      const mark = vi.spyOn(mentionsApi, 'markMentionsRead').mockResolvedValue(1)
      const result = store.markRead(store.mentions[0])
      expect(store.mentions[0].read_at).not.toBeNull()
      expect(store.unreadCount).toBe(1)
      expect(await result).toBe(true)
      expect(mark).toHaveBeenCalledWith({ ids: [3] })
      expect(store.unreadCount).toBe(1)
    })

    it('marks several and skips the ones already read', async () => {
      const { store } = await loaded()
      const mark = vi.spyOn(mentionsApi, 'markMentionsRead').mockResolvedValue(0)
      await store.markRead([...store.mentions])
      expect(mark).toHaveBeenCalledTimes(1)
      expect(mark).toHaveBeenCalledWith({ ids: [3, 2] })
      expect(store.mentions.every((m) => m.read_at !== null)).toBe(true)
      expect(store.unreadCount).toBe(0)
    })

    it('does not call the API when everything given is already read', async () => {
      const { store } = await loaded()
      const mark = vi.spyOn(mentionsApi, 'markMentionsRead')
      expect(await store.markRead(store.mentions[2])).toBe(true)
      expect(await store.markRead([])).toBe(true)
      expect(mark).not.toHaveBeenCalled()
      expect(store.unreadCount).toBe(2)
    })

    it('splits more than 100 ids into several requests', async () => {
      const many = Array.from({ length: 150 }, (_, i) => mention(i + 1))
      vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page(many, 150))
      const mark = vi.spyOn(mentionsApi, 'markMentionsRead').mockResolvedValueOnce(50).mockResolvedValueOnce(0)
      const { store } = setup()
      await store.refresh()
      await store.markRead([...store.mentions])
      expect(mark.mock.calls.map(([sel]) => ('ids' in sel ? sel.ids.length : -1))).toEqual([100, 50])
      expect(store.unreadCount).toBe(0)
    })

    it('restores the rows and the counter, then resyncs, when marking fails', async () => {
      const { store } = await loaded()
      const list = vi.mocked(mentionsApi.listMentions)
      vi.spyOn(mentionsApi, 'markMentionsRead').mockRejectedValue(new ApiError(500, 'x'))
      const result = store.markRead(store.mentions[0])
      expect(store.unreadCount).toBe(1)
      expect(await result).toBe(false)
      expect(store.mentions[0].read_at).toBeNull()
      expect(store.unreadCount).toBe(2)
      expect(list).toHaveBeenCalledTimes(2)
    })

    it('marks all optimistically, including rows loaded meanwhile, and takes the API count', async () => {
      const { store } = await loaded()
      const mark = vi.spyOn(mentionsApi, 'markMentionsRead').mockResolvedValue(0)
      const result = store.markAllRead()
      expect(store.unreadCount).toBe(0)
      expect(store.mentions.every((m) => m.read_at !== null)).toBe(true)
      expect(await result).toBe(true)
      expect(mark).toHaveBeenCalledWith({ all: true })
    })

    it('restores everything when marking all fails', async () => {
      const { store } = await loaded()
      vi.spyOn(mentionsApi, 'markMentionsRead').mockRejectedValue(new ApiError(500, 'x'))
      expect(await store.markAllRead()).toBe(false)
      expect(store.mentions.map((m) => m.read_at !== null)).toEqual([false, false, true])
      expect(store.unreadCount).toBe(2)
    })

    it('refetches when a refresh in flight was answered before the mark committed', async () => {
      const { store } = await loaded()
      const stale = deferred<MentionPage>()
      const list = vi.mocked(mentionsApi.listMentions)
      list.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(page([mention(3, true), mention(2), mention(1, true)], 1))
      vi.spyOn(mentionsApi, 'markMentionsRead').mockResolvedValue(1)
      const refresh = store.refresh()
      await store.markRead(store.mentions[0])
      stale.resolve(page([mention(3), mention(2), mention(1, true)], 2))
      await refresh
      await vi.waitFor(() => expect(store.loading).toBe(false))
      expect(store.mentions[0].read_at).not.toBeNull()
      expect(store.unreadCount).toBe(1)
    })

    it('keeps a local read when a page requested before the mark committed arrives later', async () => {
      vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(3), mention(2)], 2, 'c1'))
      const { store } = setup()
      await store.refresh()
      const more = deferred<MentionPage>()
      vi.mocked(mentionsApi.listMentions).mockReturnValueOnce(more.promise)
      vi.spyOn(mentionsApi, 'markMentionsRead').mockResolvedValue(1)
      const loading = store.loadMore()
      await store.markRead(store.mentions[0])
      more.resolve(page([mention(3), mention(1)], 2, null))
      await loading
      expect(store.mentions.map((m) => [m.id, m.read_at !== null])).toEqual([[3, true], [2, false], [1, false]])
      expect(store.unreadCount).toBe(1)
    })

    it('treats the rows of a page in flight as read when mark all is confirmed meanwhile', async () => {
      vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(3), mention(2)], 2, 'c1'))
      const { store } = setup()
      await store.refresh()
      const more = deferred<MentionPage>()
      vi.mocked(mentionsApi.listMentions).mockReturnValueOnce(more.promise)
      vi.spyOn(mentionsApi, 'markMentionsRead').mockResolvedValue(0)
      const loading = store.loadMore()
      await store.markAllRead()
      more.resolve(page([mention(1)], 1, null))
      await loading
      expect(store.mentions.every((m) => m.read_at !== null)).toBe(true)
      expect(store.unreadCount).toBe(0)
    })

    it('keeps everything read when mark all is confirmed while a refresh is in flight', async () => {
      const { store } = await loaded()
      const stale = deferred<MentionPage>()
      const list = vi.mocked(mentionsApi.listMentions)
      list.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(page([mention(3, true), mention(2, true), mention(1, true)], 0))
      vi.spyOn(mentionsApi, 'markMentionsRead').mockResolvedValue(0)
      const refresh = store.refresh()
      await store.markAllRead()
      stale.resolve(page([mention(3), mention(2), mention(1, true)], 2))
      await refresh
      await vi.waitFor(() => expect(store.loading).toBe(false))
      expect(store.mentions.every((m) => m.read_at !== null)).toBe(true)
      expect(store.unreadCount).toBe(0)
    })

    it('ignores the result of a mark that finishes after a clear', async () => {
      const { organization, store } = await loaded()
      const mark = deferred<number>()
      vi.spyOn(mentionsApi, 'markMentionsRead').mockReturnValue(mark.promise)
      const result = store.markRead(store.mentions[0])
      organization.clear()
      mark.resolve(1)
      await result
      expect(store.unreadCount).toBe(0)
      expect(store.mentions).toEqual([])
    })
  })

  describe('realtime', () => {
    function startLive(orgId = 1) {
      const fake = createFakeRealtimeClient()
      setRealtimeClientFactory(() => fake.client)
      const ctx = setup(orgId)
      ctx.store.start(7)
      return { ...fake, ...ctx }
    }

    it('subscribes to the user channel and loads the initial unread count', async () => {
      const list = vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(1)], 4))
      const { client, store } = startLive()
      await vi.waitFor(() => expect(store.unreadCount).toBe(4))
      expect(client.private).toHaveBeenCalledWith('users.7')
      expect(list).toHaveBeenCalledTimes(1)
    })

    it('counts a live mention and refreshes to bring the row', async () => {
      const list = vi
        .spyOn(mentionsApi, 'listMentions')
        .mockResolvedValueOnce(page([mention(1)], 1))
        .mockResolvedValueOnce(page([mention(2), mention(1)], 2))
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      listeners.get(`users.7|${MENTION_CREATED_EVENT}`)?.(live(1, 102))
      expect(store.unreadCount).toBe(2)
      await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(store.mentions).toHaveLength(2))
      expect(store.unreadCount).toBe(2)
    })

    it('does not count twice a live mention already loaded or already received', async () => {
      const list = vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(1)], 1))
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      const emit = listeners.get(`users.7|${MENTION_CREATED_EVENT}`)
      emit?.(live(1, 101))
      expect(store.unreadCount).toBe(1)
      expect(list).toHaveBeenCalledTimes(1)
      list.mockResolvedValue(page([mention(2), mention(1)], 2))
      emit?.(live(1, 102))
      emit?.(live(1, 102))
      expect(store.unreadCount).toBe(2)
      await vi.waitFor(() => expect(store.mentions).toHaveLength(2))
      expect(store.unreadCount).toBe(2)
    })

    it('ignores a mention from another organization', async () => {
      const list = vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([], 0))
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      listeners.get(`users.7|${MENTION_CREATED_EVENT}`)?.(live(2, 102))
      expect(store.unreadCount).toBe(0)
      expect(list).toHaveBeenCalledTimes(1)
    })

    it('ignores a malformed payload', async () => {
      vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([], 0))
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      const emit = listeners.get(`users.7|${MENTION_CREATED_EVENT}`)
      emit?.({ organization_id: 1 })
      emit?.({ organization_id: 1, channel_id: 4 })
      expect(store.unreadCount).toBe(0)
    })

    it('keeps the live increment if the refresh fails', async () => {
      vi.spyOn(mentionsApi, 'listMentions')
        .mockResolvedValueOnce(page([], 1))
        .mockRejectedValueOnce(new ApiError(500, 'x'))
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      listeners.get(`users.7|${MENTION_CREATED_EVENT}`)?.(live(1, 102))
      await vi.waitFor(() => expect(store.error).not.toBeNull())
      expect(store.unreadCount).toBe(2)
    })

    it('keeps a mention that arrived live while marking all failed', async () => {
      vi.spyOn(mentionsApi, 'listMentions').mockResolvedValueOnce(page([mention(1)], 2)).mockResolvedValue(page([mention(1)], 3))
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      const mark = deferred<number>()
      vi.spyOn(mentionsApi, 'markMentionsRead').mockReturnValue(mark.promise)
      const result = store.markAllRead()
      listeners.get(`users.7|${MENTION_CREATED_EVENT}`)?.(live(1, 50))
      expect(store.unreadCount).toBe(1)
      mark.reject(new ApiError(500, 'x'))
      expect(await result).toBe(false)
      expect(store.unreadCount).toBe(3)
    })

    describe('mention.removed', () => {
      const removed = (orgId: number, messageId: number) => ({
        organization_id: orgId,
        channel_id: 4,
        parent_id: null,
        message_id: messageId,
      })

      it('drops an unread row and lowers the counter; a read row leaves the counter alone', async () => {
        vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(2), mention(1, true)], 1))
        const { listeners, store } = startLive()
        await vi.waitFor(() => expect(store.loaded).toBe(true))
        const emit = listeners.get(`users.7|${MENTION_REMOVED_EVENT}`)
        emit?.(removed(1, 102))
        expect(store.mentions.map((m) => m.id)).toEqual([1])
        expect(store.unreadCount).toBe(0)
        emit?.(removed(1, 101))
        expect(store.mentions).toEqual([])
        expect(store.unreadCount).toBe(0)
      })

      it('refreshes the counter when the row is not loaded', async () => {
        const list = vi
          .spyOn(mentionsApi, 'listMentions')
          .mockResolvedValueOnce(page([mention(5)], 3))
          .mockResolvedValueOnce(page([mention(5)], 2))
        const { listeners, store } = startLive()
        await vi.waitFor(() => expect(store.loaded).toBe(true))
        listeners.get(`users.7|${MENTION_REMOVED_EVENT}`)?.(removed(1, 999))
        await vi.waitFor(() => expect(store.unreadCount).toBe(2))
        expect(list).toHaveBeenCalledTimes(2)
        expect(store.mentions).toHaveLength(1)
      })

      it('ignores another organization', async () => {
        const list = vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(1)], 1))
        const { listeners, store } = startLive()
        await vi.waitFor(() => expect(store.loaded).toBe(true))
        listeners.get(`users.7|${MENTION_REMOVED_EVENT}`)?.(removed(2, 101))
        expect(store.mentions).toHaveLength(1)
        expect(store.unreadCount).toBe(1)
        expect(list).toHaveBeenCalledTimes(1)
      })

      it('does not bring the row back from a refresh that started before the removal', async () => {
        const stale = deferred<MentionPage>()
        vi.spyOn(mentionsApi, 'listMentions')
          .mockResolvedValueOnce(page([mention(1)], 1))
          .mockReturnValueOnce(stale.promise)
          .mockResolvedValue(page([], 0))
        const { listeners, store } = startLive()
        await vi.waitFor(() => expect(store.loaded).toBe(true))
        void store.refresh()
        listeners.get(`users.7|${MENTION_REMOVED_EVENT}`)?.(removed(1, 101))
        stale.resolve(page([mention(1)], 1))
        await vi.waitFor(() => expect(store.loading).toBe(false))
        expect(store.mentions).toEqual([])
        expect(store.unreadCount).toBe(0)
      })

      it('shows the mention again if the same message mentions the user again later', async () => {
        vi.spyOn(mentionsApi, 'listMentions')
          .mockResolvedValueOnce(page([mention(1)], 1))
          .mockResolvedValueOnce(page([mention(2)], 1))
        const { listeners, store } = startLive()
        await vi.waitFor(() => expect(store.loaded).toBe(true))
        listeners.get(`users.7|${MENTION_REMOVED_EVENT}`)?.(removed(1, 101))
        listeners.get(`users.7|${MENTION_CREATED_EVENT}`)?.(live(1, 102))
        await vi.waitFor(() => expect(store.mentions.map((m) => m.id)).toEqual([2]))
      })
    })

    it('refreshes the counter when the connection comes back (not on first connect)', async () => {
      const list = vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([], 1))
      const { setStatus, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      setStatus('connected')
      expect(list).toHaveBeenCalledTimes(1)
      setStatus('disconnected')
      list.mockResolvedValue(page([mention(9)], 6))
      setStatus('connected')
      await vi.waitFor(() => expect(store.unreadCount).toBe(6))
      expect(list).toHaveBeenCalledTimes(2)
    })

    it('reloads for the new organization and ignores events of the old one', async () => {
      const list = vi
        .spyOn(mentionsApi, 'listMentions')
        .mockResolvedValueOnce(page([mention(1)], 3))
        .mockResolvedValueOnce(page([mention(2)], 1))
      const { listeners, organization, store } = startLive()
      await vi.waitFor(() => expect(store.unreadCount).toBe(3))
      organization.$patch({ activeId: 2 })
      expect(store.mentions).toEqual([])
      expect(store.unreadCount).toBe(0)
      await vi.waitFor(() => expect(store.unreadCount).toBe(1))
      expect(list).toHaveBeenCalledTimes(2)
      listeners.get(`users.7|${MENTION_CREATED_EVENT}`)?.(live(1, 150))
      expect(store.unreadCount).toBe(1)
    })

    it('clears on logout and does not reload', async () => {
      const list = vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(1)], 3))
      const { organization, store } = startLive()
      await vi.waitFor(() => expect(store.unreadCount).toBe(3))
      organization.clear()
      expect(store.mentions).toEqual([])
      expect(store.unreadCount).toBe(0)
      expect(list).toHaveBeenCalledTimes(1)
    })

    it('stop() leaves the channel, drops the state and ignores later events and reconnects', async () => {
      const list = vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(1)], 3))
      const { client, listeners, setStatus, store } = startLive()
      await vi.waitFor(() => expect(store.unreadCount).toBe(3))
      store.stop()
      expect(client.leave).toHaveBeenCalledWith('users.7')
      expect(store.unreadCount).toBe(0)
      listeners.get(`users.7|${MENTION_CREATED_EVENT}`)?.(live(1, 102))
      setStatus('connected')
      setStatus('disconnected')
      setStatus('connected')
      expect(store.unreadCount).toBe(0)
      expect(list).toHaveBeenCalledTimes(1)
    })
  })
})
