import { create } from 'zustand'

import { ApiError } from '@/api/client'
import { useOrganizationStore } from '@/organization/store'
import { type MentionRemovedPayload, type NotificationCreatedPayload, onReconnect, subscribeToUser } from '@/realtime/echo'

import {
  listNotifications,
  markNotificationsRead,
  NOTIFICATIONS_PER_PAGE,
  NOTIFICATIONS_READ_MAX_IDS,
  parseNotification,
} from './api'
import type { AppNotification } from './types'

interface NotificationsState {
  notifications: AppNotification[]
  unreadCount: number
  nextCursor: string | null
  loaded: boolean
  loading: boolean
  loadingMore: boolean
  error: ApiError | null
  loadMoreFailed: boolean
  refresh(): Promise<void>
  loadMore(): Promise<void>
  markRead(targets: AppNotification | readonly AppNotification[]): Promise<boolean>
  markAllRead(): Promise<boolean>
  clear(): void
  start(userId: number): void
  stop(): void
}

let generation = 0
let fetchVersion = 0
let countVersion = 0
let readAllVersion = 0
let readAllAt = ''
let liveSequence = 0
let controller = new AbortController()
let stopLive: (() => void) | null = null
// Rows that arrived live, with the sequence at that moment: a refresh that started before may not include them, so its
// unread count is topped up with the unread ones it lacks. A refresh that started after supersedes the entry.
const liveArrivals = new Map<number, number>()
// Chat messages whose mention was removed, with the sequence at that moment, so a page fetched before cannot bring the row back.
const removedMentions = new Map<number, number>()
const MAX_REMOVED_MENTIONS = 200

function toApiError(caught: unknown): ApiError {
  return caught instanceof ApiError ? caught : new ApiError(0, String(caught))
}

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

function pruneDeleted(
  current: readonly AppNotification[],
  page: { data: readonly AppNotification[]; meta: { next_cursor: string | null } },
  startedAt: number,
): AppNotification[] {
  const floor = page.meta.next_cursor === null || page.data.length === 0 ? 0 : Math.min(...page.data.map((row) => row.id))
  const inPage = new Set(page.data.map((row) => row.id))
  return current.filter((row) => row.id < floor || inPage.has(row.id) || (liveArrivals.get(row.id) ?? 0) > startedAt)
}

function removedSince(row: AppNotification, startedAt: number): boolean {
  return row.type === 'chat_mention' && (removedMentions.get(row.data.message_id) ?? 0) > startedAt
}

function unreadMissingFrom(current: readonly AppNotification[], page: readonly AppNotification[], startedAt: number): number {
  const inPage = new Set(page.map((row) => row.id))
  let missing = 0
  for (const [id, arrivedAt] of liveArrivals) {
    if (arrivedAt <= startedAt) {
      liveArrivals.delete(id)
      continue
    }
    const row = current.find((candidate) => candidate.id === id)
    if (!inPage.has(id) && row !== undefined && row.read_at === null) missing++
  }
  return missing
}

export const useNotificationsStore = create<NotificationsState>()((set, get) => {
  function setUnread(count: number): void {
    countVersion++
    set({ unreadCount: Math.max(0, count) })
  }

  function setReadAt(ids: ReadonlySet<number>, readAt: string | null): void {
    set((state) => ({
      notifications: state.notifications.map((row) => (ids.has(row.id) ? { ...row, read_at: readAt } : row)),
    }))
  }

  function invalidateInFlight(): void {
    if (get().loading) void get().refresh()
  }

  function onNotificationCreated(payload: NotificationCreatedPayload): void {
    if (payload.organizationId !== useOrganizationStore.getState().activeId) return
    const incoming = parseNotification(payload.notification)
    if (incoming === null) return
    if (get().notifications.some((row) => row.id === incoming.id)) return
    if (incoming.type === 'chat_mention') removedMentions.delete(incoming.data.message_id)
    liveArrivals.set(incoming.id, ++liveSequence)
    set({ notifications: mergeNotifications(get().notifications, [incoming]) })
    if (incoming.read_at === null) setUnread(get().unreadCount + 1)
  }

  function onMentionRemoved(payload: MentionRemovedPayload): void {
    if (payload.organizationId !== useOrganizationStore.getState().activeId) return
    removedMentions.delete(payload.messageId)
    removedMentions.set(payload.messageId, ++liveSequence)
    if (removedMentions.size > MAX_REMOVED_MENTIONS) {
      const oldest = removedMentions.keys().next()
      if (!oldest.done) removedMentions.delete(oldest.value)
    }
    const removed = get().notifications.filter(
      (row) => row.type === 'chat_mention' && row.data.message_id === payload.messageId,
    )
    if (removed.length === 0) {
      if (get().loaded) void get().refresh()
      return
    }
    const gone = new Set(removed.map((row) => row.id))
    for (const id of gone) liveArrivals.delete(id)
    set({ notifications: get().notifications.filter((row) => !gone.has(row.id)) })
    setUnread(get().unreadCount - removed.filter((row) => row.read_at === null).length)
  }

  return {
    notifications: [],
    unreadCount: 0,
    nextCursor: null,
    loaded: false,
    loading: false,
    loadingMore: false,
    error: null,
    loadMoreFailed: false,

    refresh() {
      if (useOrganizationStore.getState().activeId === null) return Promise.resolve()
      const current = generation
      const version = ++fetchVersion
      const startedAt = liveSequence
      set({ loading: true })
      return listNotifications({ perPage: NOTIFICATIONS_PER_PAGE }, controller.signal)
        .then((page) => {
          if (current !== generation || version !== fetchVersion) return
          const state = get()
          const rows = page.data.filter((row) => !removedSince(row, startedAt))
          const unreadDropped = page.data.filter((row) => removedSince(row, startedAt) && row.read_at === null).length
          const merged = mergeNotifications(pruneDeleted(state.notifications, page, startedAt), rows)
          set({
            notifications: merged,
            ...(state.loaded ? {} : { nextCursor: page.meta.next_cursor, loaded: true }),
            error: null,
          })
          setUnread(page.meta.unread_count - unreadDropped + unreadMissingFrom(merged, rows, startedAt))
        })
        .catch((caught: unknown) => {
          if (current !== generation || version !== fetchVersion) return
          set({ error: toApiError(caught) })
        })
        .finally(() => {
          if (current === generation && version === fetchVersion) set({ loading: false })
        })
    },

    async loadMore() {
      const { nextCursor: cursor, loaded, loadingMore } = get()
      if (cursor === null || !loaded || loadingMore) return
      const current = generation
      const counted = countVersion
      const readAll = readAllVersion
      const startedAt = liveSequence
      set({ loadingMore: true, loadMoreFailed: false })
      try {
        const page = await listNotifications({ cursor, perPage: NOTIFICATIONS_PER_PAGE }, controller.signal)
        if (current !== generation) return
        const fresh = page.data.filter((row) => !removedSince(row, startedAt))
        const rows =
          readAll === readAllVersion
            ? fresh
            : fresh.map((row) => (row.read_at === null ? { ...row, read_at: readAllAt } : row))
        set({ notifications: mergeNotifications(get().notifications, rows), nextCursor: page.meta.next_cursor })
        if (counted === countVersion) setUnread(page.meta.unread_count)
      } catch {
        if (current === generation) set({ loadMoreFailed: true })
      } finally {
        if (current === generation) set({ loadingMore: false })
      }
    },

    async markRead(targets) {
      const wanted = new Set((Array.isArray(targets) ? targets : [targets]).map((row: AppNotification) => row.id))
      const ids = get()
        .notifications.filter((row) => wanted.has(row.id) && row.read_at === null)
        .map((row) => row.id)
      if (ids.length === 0) return true
      const current = generation
      const flipped = new Set(ids)
      const readAt = new Date().toISOString()
      setReadAt(flipped, readAt)
      setUnread(get().unreadCount - ids.length)
      try {
        let count = get().unreadCount
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
        setUnread(get().unreadCount + ids.length)
        void get().refresh()
        return false
      }
    },

    async markAllRead() {
      const before = get().unreadCount
      const current = generation
      const flipped = new Set(get().notifications.filter((row) => row.read_at === null).map((row) => row.id))
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
        setUnread(get().unreadCount + before)
        void get().refresh()
        return false
      }
    },

    start(userId) {
      get().stop()
      const unsubscribeUser = subscribeToUser(userId, { onNotificationCreated, onMentionRemoved })
      const unsubscribeReconnect = onReconnect(() => void get().refresh())
      stopLive = () => {
        unsubscribeUser()
        unsubscribeReconnect()
      }
      void get().refresh()
    },

    stop() {
      stopLive?.()
      stopLive = null
      get().clear()
    },

    clear() {
      liveArrivals.clear()
      removedMentions.clear()
      generation++
      fetchVersion++
      countVersion++
      controller.abort()
      controller = new AbortController()
      set({
        notifications: [],
        unreadCount: 0,
        nextCursor: null,
        loaded: false,
        loading: false,
        loadingMore: false,
        error: null,
        loadMoreFailed: false,
      })
    },
  }
})

useOrganizationStore.subscribe((state, previous) => {
  if (state.activeId === previous.activeId) return
  useNotificationsStore.getState().clear()
  if (stopLive !== null && state.activeId !== null) void useNotificationsStore.getState().refresh()
})
