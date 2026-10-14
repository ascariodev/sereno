import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import { ApiError } from '../api/client'
import {
  listNotifications,
  markNotificationsRead,
  NOTIFICATIONS_PER_PAGE,
  NOTIFICATIONS_READ_MAX_IDS,
  parseNotification,
} from '../api/notifications'
import type { AppNotification } from '../api/types'
import { notifyDesktop } from '../platform/desktopNotifications'
import { type NotificationCreatedPayload, onReconnect, subscribeToUser } from '../realtime/echo'
import { useOrganizationStore } from './organization'

function toApiError(caught: unknown): ApiError {
  return caught instanceof ApiError ? caught : new ApiError(0, String(caught))
}

/**
 * Merges by notification id (the incoming version wins, except it never un-reads a local read) and sorts newest first.
 * Keeping the local `read_at` is only correct while there is no "mark as unread" action; adding one means revisiting this.
 */
function mergeNotifications(current: readonly AppNotification[], incoming: readonly AppNotification[]): AppNotification[] {
  const byId = new Map(current.map((notification) => [notification.id, notification]))
  for (const notification of incoming) {
    const local = byId.get(notification.id)
    byId.set(
      notification.id,
      local?.read_at != null && notification.read_at === null ? { ...notification, read_at: local.read_at } : notification,
    )
  }
  return [...byId.values()].sort((a, b) => b.id - a.id)
}

/**
 * Notification inbox of the active organization. `unreadCount` comes from the API (`meta.unread_count`) and is adjusted
 * locally only between responses. The live event carries the whole row, so it is merged in directly (once per id); a
 * refresh or page already in flight never drops it nor loses its count. Everything is dropped on any organization
 * change or logout.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  const organization = useOrganizationStore()
  const notifications = shallowRef<AppNotification[]>([])
  const unreadCount = ref(0)
  const nextCursor = ref<string | null>(null)
  const loaded = ref(false)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<ApiError | null>(null)
  const loadMoreFailed = ref(false)
  let generation = 0
  let fetchVersion = 0
  let countVersion = 0
  let readAllVersion = 0
  let readAllAt = ''
  let liveSequence = 0
  let controller = new AbortController()
  let live = false
  let stopLive: (() => void) | null = null
  // Rows that arrived live, with the sequence at that moment: a refresh that started before may not include them, so
  // its unread count is topped up with the unread ones it lacks. A refresh that started after supersedes the entry.
  const liveArrivals = new Map<number, number>()

  function setUnread(count: number): void {
    unreadCount.value = Math.max(0, count)
    countVersion++
  }

  function clear(): void {
    generation++
    fetchVersion++
    countVersion++
    controller.abort()
    controller = new AbortController()
    liveArrivals.clear()
    notifications.value = []
    unreadCount.value = 0
    nextCursor.value = null
    loaded.value = false
    loading.value = false
    loadingMore.value = false
    error.value = null
    loadMoreFailed.value = false
  }

  watch(
    () => organization.activeId,
    (id) => {
      clear()
      if (live && id !== null) void refresh()
    },
    { flush: 'sync' },
  )

  /** Unread live rows that arrived after the request started and are not in its page. */
  function unreadMissingFrom(page: readonly AppNotification[], startedAt: number): number {
    const inPage = new Set(page.map((row) => row.id))
    let missing = 0
    for (const [id, arrivedAt] of liveArrivals) {
      if (arrivedAt <= startedAt) {
        liveArrivals.delete(id)
        continue
      }
      const row = notifications.value.find((candidate) => candidate.id === id)
      if (!inPage.has(id) && row !== undefined && row.read_at === null) missing++
    }
    return missing
  }

  /**
   * Drops the loaded rows the first page's id range covers but the page lacks (deleted in the API); older rows loaded by
   * cursor stay. A page without `next_cursor` covers everything. Live rows that arrived after the request started stay.
   */
  function pruneDeleted(
    current: readonly AppNotification[],
    page: { data: readonly AppNotification[]; meta: { next_cursor: string | null } },
    startedAt: number,
  ): readonly AppNotification[] {
    const floor = page.meta.next_cursor === null || page.data.length === 0 ? 0 : Math.min(...page.data.map((row) => row.id))
    const inPage = new Set(page.data.map((row) => row.id))
    return current.filter(
      (row) => row.id < floor || inPage.has(row.id) || (liveArrivals.get(row.id) ?? 0) > startedAt,
    )
  }

  /** Loads the first page and merges it into what is already there; the newest request wins. Also the way to reload. */
  function refresh(): Promise<void> {
    if (organization.activeId === null) return Promise.resolve()
    const current = generation
    const version = ++fetchVersion
    const startedAt = liveSequence
    loading.value = true
    return listNotifications({ perPage: NOTIFICATIONS_PER_PAGE }, controller.signal)
      .then((page) => {
        if (current !== generation || version !== fetchVersion) return
        notifications.value = mergeNotifications(pruneDeleted(notifications.value, page, startedAt), page.data)
        if (!loaded.value) {
          nextCursor.value = page.meta.next_cursor
          loaded.value = true
        }
        setUnread(page.meta.unread_count + unreadMissingFrom(page.data, startedAt))
        error.value = null
      })
      .catch((caught: unknown) => {
        if (current !== generation || version !== fetchVersion) return
        error.value = toApiError(caught)
      })
      .finally(() => {
        if (current === generation && version === fetchVersion) loading.value = false
      })
  }

  async function loadMore(): Promise<void> {
    const cursor = nextCursor.value
    if (cursor === null || !loaded.value || loadingMore.value) return
    const current = generation
    const counted = countVersion
    const readAll = readAllVersion
    loadingMore.value = true
    loadMoreFailed.value = false
    try {
      const page = await listNotifications({ cursor, perPage: NOTIFICATIONS_PER_PAGE }, controller.signal)
      if (current !== generation) return
      // A "mark all" confirmed while this page was in flight covers its (older) rows, which may still arrive unread.
      const rows =
        readAll === readAllVersion
          ? page.data
          : page.data.map((row) => (row.read_at === null ? { ...row, read_at: readAllAt } : row))
      notifications.value = mergeNotifications(notifications.value, rows)
      nextCursor.value = page.meta.next_cursor
      if (counted === countVersion) setUnread(page.meta.unread_count)
    } catch {
      if (current === generation) loadMoreFailed.value = true
    } finally {
      if (current === generation) loadingMore.value = false
    }
  }

  function setReadAt(ids: ReadonlySet<number>, readAt: string | null): void {
    notifications.value = notifications.value.map((row) => (ids.has(row.id) ? { ...row, read_at: readAt } : row))
  }

  /** A read confirmed by the server makes a refresh still in flight stale (its count at least): launch a newer one. */
  function invalidateInFlight(): void {
    if (loading.value) void refresh()
  }

  /** Marks the given loaded notifications read, optimistically. Resolves false (state restored, then resynced) if the API fails. */
  async function markRead(targets: AppNotification | readonly AppNotification[]): Promise<boolean> {
    const wanted = new Set((Array.isArray(targets) ? targets : [targets]).map((row: AppNotification) => row.id))
    const ids = notifications.value.filter((row) => wanted.has(row.id) && row.read_at === null).map((row) => row.id)
    if (ids.length === 0) return true
    const current = generation
    const flipped = new Set(ids)
    const readAt = new Date().toISOString()
    setReadAt(flipped, readAt)
    setUnread(unreadCount.value - ids.length)
    try {
      let count = unreadCount.value
      for (let i = 0; i < ids.length; i += NOTIFICATIONS_READ_MAX_IDS) {
        count = await markNotificationsRead({ ids: ids.slice(i, i + NOTIFICATIONS_READ_MAX_IDS) })
      }
      if (current === generation) {
        setReadAt(flipped, readAt)
        setUnread(count)
        invalidateInFlight()
      }
      return true
    } catch {
      if (current !== generation) return false
      setReadAt(flipped, null)
      setUnread(unreadCount.value + ids.length)
      void refresh()
      return false
    }
  }

  async function markAllRead(): Promise<boolean> {
    const before = unreadCount.value
    const current = generation
    const flipped = new Set(notifications.value.filter((row) => row.read_at === null).map((row) => row.id))
    const readAt = new Date().toISOString()
    setReadAt(flipped, readAt)
    setUnread(0)
    try {
      const count = await markNotificationsRead({ all: true })
      if (current !== generation) return true
      setReadAt(flipped, readAt)
      setUnread(count)
      readAllAt = readAt
      readAllVersion++
      invalidateInFlight()
      return true
    } catch {
      if (current !== generation) return false
      setReadAt(flipped, null)
      setUnread(unreadCount.value + before)
      void refresh()
      return false
    }
  }

  function onNotificationCreated(payload: NotificationCreatedPayload): void {
    if (payload.organizationId !== organization.activeId) return
    const incoming = parseNotification(payload.notification)
    if (incoming === null) return
    if (notifications.value.some((row) => row.id === incoming.id)) return
    liveArrivals.set(incoming.id, ++liveSequence)
    notifications.value = mergeNotifications(notifications.value, [incoming])
    if (incoming.read_at === null) setUnread(unreadCount.value + 1)
    const current = generation
    void notifyDesktop(incoming, payload.organizationId, () => (current === generation ? organization.activeId : null))
  }

  /** Subscribes to `notification.created` in the user channel and refreshes on reconnect; call `stop()` on logout or unmount. */
  function start(userId: number): void {
    stop()
    live = true
    const unsubscribeUser = subscribeToUser(userId, { onNotificationCreated })
    const unsubscribeReconnect = onReconnect(() => void refresh())
    stopLive = () => {
      unsubscribeUser()
      unsubscribeReconnect()
    }
    void refresh()
  }

  function stop(): void {
    stopLive?.()
    stopLive = null
    live = false
    clear()
  }

  return {
    notifications,
    unreadCount,
    nextCursor,
    loaded,
    loading,
    loadingMore,
    error,
    loadMoreFailed,
    refresh,
    loadMore,
    markRead,
    markAllRead,
    start,
    stop,
    clear,
  }
})
