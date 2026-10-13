import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import * as notificationsApi from '../api/notifications'
import type { AppNotification, NotificationPage } from '../api/types'
import { disconnectRealtime, NOTIFICATION_CREATED_EVENT, setRealtimeClientFactory } from '../realtime/echo'
import { createFakeRealtimeClient } from '../test/fakeRealtimeClient'
import { useNotificationsStore } from './notifications'
import { useOrganizationStore } from './organization'

const rawRow = (id: number, read = false) => ({
  id,
  type: 'task_assigned',
  project_id: 1,
  data: { task_id: id, task_key: `T-${id}`, task_title: 'Fix', actor_id: 2, actor_name: 'Ana' },
  read_at: read ? '2026-10-13T11:00:00Z' : null,
  created_at: '2026-10-13T10:00:00Z',
})

const notification = (id: number, read = false) => notificationsApi.parseNotification(rawRow(id, read)) as AppNotification

const page = (data: AppNotification[], unread: number, next: string | null = null): NotificationPage => ({
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
  return { organization, store: useNotificationsStore() }
}

function live(orgId: number, id: number, read = false) {
  return { organization_id: orgId, notification: rawRow(id, read) }
}

async function loaded(rows: AppNotification[] = [notification(2), notification(1)], unread = 2) {
  vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValueOnce(page(rows, unread))
  const ctx = setup()
  await ctx.store.refresh()
  return ctx
}

describe('notifications store', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => {
    disconnectRealtime()
    setRealtimeClientFactory(null)
  })

  describe('loading', () => {
    it('loads the first page with its unread count', async () => {
      const list = vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([notification(3), notification(2, true)], 5, 'c1'))
      const { store } = setup()
      await store.refresh()
      expect(list.mock.calls[0][0]).toEqual({ perPage: notificationsApi.NOTIFICATIONS_PER_PAGE })
      expect(store.notifications.map((n) => n.id)).toEqual([3, 2])
      expect(store.unreadCount).toBe(5)
      expect(store.nextCursor).toBe('c1')
      expect(store.loaded).toBe(true)
      expect(store.loading).toBe(false)
    })

    it('does nothing without an active organization', async () => {
      const list = vi.spyOn(notificationsApi, 'listNotifications')
      const { store } = setup(null)
      await store.refresh()
      expect(list).not.toHaveBeenCalled()
    })

    it('keeps the error and the previous data when a refresh fails', async () => {
      vi.spyOn(notificationsApi, 'listNotifications')
        .mockResolvedValueOnce(page([notification(1)], 1))
        .mockRejectedValueOnce(new ApiError(500, 'x'))
      const { store } = setup()
      await store.refresh()
      await store.refresh()
      expect(store.error?.status).toBe(500)
      expect(store.notifications).toHaveLength(1)
      expect(store.unreadCount).toBe(1)
    })

    it('paginates with the cursor, merges without duplicates and keeps newest first', async () => {
      const list = vi
        .spyOn(notificationsApi, 'listNotifications')
        .mockResolvedValueOnce(page([notification(5), notification(4)], 3, 'c1'))
        .mockResolvedValueOnce(page([notification(4), notification(2)], 3, null))
      const { store } = setup()
      await store.refresh()
      await store.loadMore()
      expect(list.mock.calls[1][0]).toEqual({ cursor: 'c1', perPage: notificationsApi.NOTIFICATIONS_PER_PAGE })
      expect(store.notifications.map((n) => n.id)).toEqual([5, 4, 2])
      expect(store.nextCursor).toBeNull()
      await store.loadMore()
      expect(list).toHaveBeenCalledTimes(2)
    })

    it('flags a failed page without touching the first-load error and allows retrying', async () => {
      vi.spyOn(notificationsApi, 'listNotifications')
        .mockResolvedValueOnce(page([notification(5)], 1, 'c1'))
        .mockRejectedValueOnce(new ApiError(500, 'x'))
        .mockResolvedValueOnce(page([notification(2)], 1, null))
      const { store } = setup()
      await store.refresh()
      await store.loadMore()
      expect(store.loadMoreFailed).toBe(true)
      expect(store.error).toBeNull()
      await store.loadMore()
      expect(store.loadMoreFailed).toBe(false)
      expect(store.notifications.map((n) => n.id)).toEqual([5, 2])
    })

    it('updates unread_count from a later page only if nothing changed it meanwhile', async () => {
      const second = deferred<NotificationPage>()
      vi.spyOn(notificationsApi, 'listNotifications')
        .mockResolvedValueOnce(page([notification(5)], 4, 'c1'))
        .mockReturnValueOnce(second.promise)
      vi.spyOn(notificationsApi, 'markNotificationsRead').mockResolvedValue(3)
      const { store } = setup()
      await store.refresh()
      const more = store.loadMore()
      await store.markRead(store.notifications[0])
      second.resolve(page([notification(2)], 4, null))
      await more
      expect(store.unreadCount).toBe(3)
      expect(store.notifications.map((n) => n.id)).toEqual([5, 2])
    })

    it('a refresh keeps the cursor of the deepest page', async () => {
      vi.spyOn(notificationsApi, 'listNotifications')
        .mockResolvedValueOnce(page([notification(5)], 2, 'c1'))
        .mockResolvedValueOnce(page([notification(3)], 2, null))
        .mockResolvedValueOnce(page([notification(6), notification(5)], 3, 'c-new'))
      const { store } = setup()
      await store.refresh()
      await store.loadMore()
      await store.refresh()
      expect(store.notifications.map((n) => n.id)).toEqual([6, 5, 3])
      expect(store.nextCursor).toBeNull()
    })
  })

  describe('late responses', () => {
    it.each([
      ['the organization changed', (ctx: ReturnType<typeof setup>) => ctx.organization.$patch({ activeId: 2 })],
      ['logout', (ctx: ReturnType<typeof setup>) => ctx.organization.clear()],
      ['clear()', (ctx: ReturnType<typeof setup>) => ctx.store.clear()],
    ])('discards a first page that arrives after %s', async (_label, reset) => {
      const first = deferred<NotificationPage>()
      vi.spyOn(notificationsApi, 'listNotifications').mockReturnValueOnce(first.promise)
      const ctx = setup()
      const pending = ctx.store.refresh()
      reset(ctx)
      first.resolve(page([notification(1)], 9))
      await pending
      expect(ctx.store.notifications).toEqual([])
      expect(ctx.store.unreadCount).toBe(0)
      expect(ctx.store.loaded).toBe(false)
      expect(ctx.store.loading).toBe(false)
    })

    it('discards a later page that arrives after clear()', async () => {
      const second = deferred<NotificationPage>()
      vi.spyOn(notificationsApi, 'listNotifications')
        .mockResolvedValueOnce(page([notification(5)], 1, 'c1'))
        .mockReturnValueOnce(second.promise)
      const { store } = setup()
      await store.refresh()
      const more = store.loadMore()
      store.clear()
      second.resolve(page([notification(2)], 7, null))
      await more
      expect(store.notifications).toEqual([])
      expect(store.unreadCount).toBe(0)
      expect(store.loadingMore).toBe(false)
    })

    it('the newest refresh wins when an older one resolves last', async () => {
      const older = deferred<NotificationPage>()
      vi.spyOn(notificationsApi, 'listNotifications')
        .mockReturnValueOnce(older.promise)
        .mockResolvedValueOnce(page([notification(2)], 1))
      const { store } = setup()
      const first = store.refresh()
      await store.refresh()
      older.resolve(page([notification(1)], 9))
      await first
      expect(store.notifications.map((n) => n.id)).toEqual([2])
      expect(store.unreadCount).toBe(1)
    })

    it('ignores a late failure after clear()', async () => {
      const first = deferred<NotificationPage>()
      vi.spyOn(notificationsApi, 'listNotifications').mockReturnValueOnce(first.promise)
      const { store } = setup()
      const pending = store.refresh()
      store.clear()
      first.reject(new ApiError(500, 'x'))
      await pending
      expect(store.error).toBeNull()
    })
  })

  describe('marking as read', () => {
    it('marks given rows read optimistically and takes the server count', async () => {
      const { store } = await loaded()
      const mark = vi.spyOn(notificationsApi, 'markNotificationsRead').mockResolvedValue(1)
      expect(await store.markRead(store.notifications[0])).toBe(true)
      expect(mark).toHaveBeenCalledWith({ ids: [2] })
      expect(store.notifications[0].read_at).not.toBeNull()
      expect(store.notifications[1].read_at).toBeNull()
      expect(store.unreadCount).toBe(1)
    })

    it('skips already read rows without calling the API', async () => {
      const { store } = await loaded([notification(2, true)], 0)
      const mark = vi.spyOn(notificationsApi, 'markNotificationsRead')
      expect(await store.markRead(store.notifications)).toBe(true)
      expect(mark).not.toHaveBeenCalled()
    })

    it('sends ids in chunks of the API maximum', async () => {
      const rows = Array.from({ length: 101 }, (_, i) => notification(200 - i))
      const { store } = await loaded(rows, 101)
      const mark = vi.spyOn(notificationsApi, 'markNotificationsRead').mockResolvedValueOnce(1).mockResolvedValueOnce(0)
      await store.markRead(store.notifications)
      expect(mark.mock.calls.map((call) => (call[0] as { ids: number[] }).ids.length)).toEqual([100, 1])
      expect(store.unreadCount).toBe(0)
    })

    it('restores the rows and resyncs when marking fails', async () => {
      const { store } = await loaded()
      vi.spyOn(notificationsApi, 'markNotificationsRead').mockRejectedValue(new ApiError(500, 'x'))
      const list = vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([notification(2), notification(1)], 2))
      expect(await store.markRead(store.notifications[0])).toBe(false)
      expect(store.notifications[0].read_at).toBeNull()
      expect(store.unreadCount).toBe(2)
      expect(list).toHaveBeenCalledTimes(2)
    })

    it('marks all read and takes the server count', async () => {
      const { store } = await loaded()
      const mark = vi.spyOn(notificationsApi, 'markNotificationsRead').mockResolvedValue(0)
      expect(await store.markAllRead()).toBe(true)
      expect(mark).toHaveBeenCalledWith({ all: true })
      expect(store.notifications.every((n) => n.read_at !== null)).toBe(true)
      expect(store.unreadCount).toBe(0)
    })

    it('restores everything when marking all fails', async () => {
      const { store } = await loaded()
      vi.spyOn(notificationsApi, 'markNotificationsRead').mockRejectedValue(new ApiError(500, 'x'))
      vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([notification(2), notification(1)], 2))
      expect(await store.markAllRead()).toBe(false)
      expect(store.notifications.every((n) => n.read_at === null)).toBe(true)
      expect(store.unreadCount).toBe(2)
    })

    it('a mark all confirmed during a page in flight also covers the arriving older rows', async () => {
      const second = deferred<NotificationPage>()
      vi.spyOn(notificationsApi, 'listNotifications')
        .mockResolvedValueOnce(page([notification(5)], 1, 'c1'))
        .mockReturnValueOnce(second.promise)
      vi.spyOn(notificationsApi, 'markNotificationsRead').mockResolvedValue(0)
      const { store } = setup()
      await store.refresh()
      const more = store.loadMore()
      await store.markAllRead()
      second.resolve(page([notification(2)], 1, null))
      await more
      expect(store.notifications.every((n) => n.read_at !== null)).toBe(true)
    })

    it('does not apply a confirmed read to a store cleared meanwhile', async () => {
      const { organization, store } = await loaded()
      const mark = deferred<number>()
      vi.spyOn(notificationsApi, 'markNotificationsRead').mockReturnValue(mark.promise)
      const result = store.markRead(store.notifications[0])
      organization.clear()
      mark.resolve(1)
      await result
      expect(store.unreadCount).toBe(0)
      expect(store.notifications).toEqual([])
    })

    it('a read confirmed while a refresh is in flight launches a newer refresh', async () => {
      const { store } = await loaded()
      const stale = deferred<NotificationPage>()
      const list = vi
        .spyOn(notificationsApi, 'listNotifications')
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValueOnce(page([notification(2, true), notification(1)], 1))
      vi.spyOn(notificationsApi, 'markNotificationsRead').mockResolvedValue(1)
      const pending = store.refresh()
      await store.markRead(store.notifications[0])
      stale.resolve(page([notification(2), notification(1)], 2))
      await pending
      expect(list).toHaveBeenCalledTimes(3)
      expect(store.unreadCount).toBe(1)
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
    const emitter = (listeners: ReturnType<typeof createFakeRealtimeClient>['listeners']) =>
      listeners.get(`users.7|${NOTIFICATION_CREATED_EVENT}`) as (data: unknown) => void

    it('subscribes to the user channel and loads the initial unread count', async () => {
      const list = vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([notification(1)], 4))
      const { client, store } = startLive()
      await vi.waitFor(() => expect(store.unreadCount).toBe(4))
      expect(client.private).toHaveBeenCalledWith('users.7')
      expect(list).toHaveBeenCalledTimes(1)
    })

    it('merges a live notification into the list on top and counts it, without a request', async () => {
      const list = vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([notification(1)], 1))
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      emitter(listeners)(live(1, 2))
      expect(store.notifications.map((n) => n.id)).toEqual([2, 1])
      expect(store.unreadCount).toBe(2)
      expect(list).toHaveBeenCalledTimes(1)
    })

    it('does not duplicate nor count twice a live notification already loaded or received', async () => {
      vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([notification(1)], 1))
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      const emit = emitter(listeners)
      emit(live(1, 1))
      emit(live(1, 2))
      emit(live(1, 2))
      expect(store.notifications.map((n) => n.id)).toEqual([2, 1])
      expect(store.unreadCount).toBe(2)
    })

    it('ignores another organization and malformed items', async () => {
      vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([notification(1)], 1))
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      const emit = emitter(listeners)
      emit(live(2, 2))
      emit({ organization_id: 1, notification: { id: 'x' } })
      expect(store.notifications.map((n) => n.id)).toEqual([1])
      expect(store.unreadCount).toBe(1)
    })

    it('keeps an unknown type as the generic variant', async () => {
      vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([], 0))
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      emitter(listeners)({ organization_id: 1, notification: { ...rawRow(3), type: 'future_thing' } })
      expect(store.notifications[0]).toMatchObject({ id: 3, type: 'unknown', original_type: 'future_thing' })
      expect(store.unreadCount).toBe(1)
    })

    it('does not count a live notification that is already read', async () => {
      vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([], 0))
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      emitter(listeners)(live(1, 3, true))
      expect(store.notifications).toHaveLength(1)
      expect(store.unreadCount).toBe(0)
    })

    it('keeps a live notification (and its count) when an older refresh resolves afterwards', async () => {
      const stale = deferred<NotificationPage>()
      vi.spyOn(notificationsApi, 'listNotifications')
        .mockResolvedValueOnce(page([notification(1)], 1))
        .mockReturnValueOnce(stale.promise)
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      const pending = store.refresh()
      emitter(listeners)(live(1, 2))
      stale.resolve(page([notification(1)], 1))
      await pending
      expect(store.notifications.map((n) => n.id)).toEqual([2, 1])
      expect(store.unreadCount).toBe(2)
    })

    it('does not add the count twice when the refresh already includes the live row', async () => {
      const response = deferred<NotificationPage>()
      vi.spyOn(notificationsApi, 'listNotifications')
        .mockResolvedValueOnce(page([notification(1)], 1))
        .mockReturnValueOnce(response.promise)
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      const pending = store.refresh()
      emitter(listeners)(live(1, 2))
      response.resolve(page([notification(2), notification(1)], 2))
      await pending
      expect(store.unreadCount).toBe(2)
    })

    it('keeps a live notification that arrives while a page is loading', async () => {
      const second = deferred<NotificationPage>()
      vi.spyOn(notificationsApi, 'listNotifications')
        .mockResolvedValueOnce(page([notification(5)], 1, 'c1'))
        .mockReturnValueOnce(second.promise)
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      const more = store.loadMore()
      emitter(listeners)(live(1, 9))
      second.resolve(page([notification(2)], 1, null))
      await more
      expect(store.notifications.map((n) => n.id)).toEqual([9, 5, 2])
      expect(store.unreadCount).toBe(2)
    })

    it('drops a live notification that was marked read locally but keeps it read after a stale refresh', async () => {
      const stale = deferred<NotificationPage>()
      vi.spyOn(notificationsApi, 'listNotifications')
        .mockResolvedValueOnce(page([], 0))
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValue(page([notification(2, true)], 0))
      vi.spyOn(notificationsApi, 'markNotificationsRead').mockResolvedValue(0)
      const { listeners, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      const pending = store.refresh()
      emitter(listeners)(live(1, 2))
      await store.markRead(store.notifications[0])
      stale.resolve(page([notification(2)], 1))
      await pending
      expect(store.notifications[0].read_at).not.toBeNull()
      expect(store.unreadCount).toBe(0)
    })

    it('clears and reloads when the organization changes, and ignores events of the previous one', async () => {
      const list = vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([notification(1)], 1))
      const { listeners, organization, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      const emit = emitter(listeners)
      emit(live(1, 2))
      organization.$patch({ activeId: 2 })
      expect(store.notifications).toEqual([])
      expect(list).toHaveBeenCalledTimes(2)
      emit(live(1, 3))
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      expect(store.notifications.map((n) => n.id)).toEqual([1])
      emit(live(2, 4))
      expect(store.notifications.map((n) => n.id)).toEqual([4, 1])
    })

    it('stop() unsubscribes and clears', async () => {
      vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([notification(1)], 1))
      const { client, store } = startLive()
      await vi.waitFor(() => expect(store.loaded).toBe(true))
      store.stop()
      expect(store.notifications).toEqual([])
      expect(store.unreadCount).toBe(0)
      expect(client.leave).toHaveBeenCalledWith('users.7')
    })
  })
})
