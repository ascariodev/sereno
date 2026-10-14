import { create } from 'zustand'

import { ApiError } from '@/api/client'
import { useOrganizationStore } from '@/organization/store'

import {
  listNotifications,
  markNotificationsRead,
  NOTIFICATIONS_PER_PAGE,
  NOTIFICATIONS_READ_MAX_IDS,
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
}

let generation = 0
let fetchVersion = 0
let countVersion = 0
let readAllVersion = 0
let readAllAt = ''
let controller = new AbortController()

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
): AppNotification[] {
  const floor = page.meta.next_cursor === null || page.data.length === 0 ? 0 : Math.min(...page.data.map((row) => row.id))
  const inPage = new Set(page.data.map((row) => row.id))
  return current.filter((row) => row.id < floor || inPage.has(row.id))
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
      set({ loading: true })
      return listNotifications({ perPage: NOTIFICATIONS_PER_PAGE }, controller.signal)
        .then((page) => {
          if (current !== generation || version !== fetchVersion) return
          const state = get()
          set({
            notifications: mergeNotifications(pruneDeleted(state.notifications, page), page.data),
            ...(state.loaded ? {} : { nextCursor: page.meta.next_cursor, loaded: true }),
            error: null,
          })
          setUnread(page.meta.unread_count)
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
      set({ loadingMore: true, loadMoreFailed: false })
      try {
        const page = await listNotifications({ cursor, perPage: NOTIFICATIONS_PER_PAGE }, controller.signal)
        if (current !== generation) return
        const rows =
          readAll === readAllVersion
            ? page.data
            : page.data.map((row) => (row.read_at === null ? { ...row, read_at: readAllAt } : row))
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

    clear() {
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
  if (state.activeId !== null) void useNotificationsStore.getState().refresh()
})
