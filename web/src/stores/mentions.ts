import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import { ApiError } from '../api/client'
import { listMentions, MENTIONS_PER_PAGE, MENTIONS_READ_MAX_IDS, markMentionsRead } from '../api/mentions'
import type { Mention } from '../api/types'
import { type MentionCreatedPayload, type MentionRemovedPayload, onReconnect, subscribeToUser } from '../realtime/echo'
import { useOrganizationStore } from './organization'

function toApiError(caught: unknown): ApiError {
  return caught instanceof ApiError ? caught : new ApiError(0, String(caught))
}

/**
 * Merges by mention id (the incoming version wins, except it never un-reads a local read) and sorts newest first.
 * Keeping the local `read_at` is only correct while there is no "mark as unread" action; adding one means revisiting this.
 */
function mergeMentions(current: readonly Mention[], incoming: readonly Mention[]): Mention[] {
  const byId = new Map(current.map((mention) => [mention.id, mention]))
  for (const mention of incoming) {
    const local = byId.get(mention.id)
    byId.set(mention.id, local?.read_at != null && mention.read_at === null ? { ...mention, read_at: local.read_at } : mention)
  }
  return [...byId.values()].sort((a, b) => b.id - a.id)
}

/**
 * Mention inbox of the active organization. `unreadCount` comes from the API (`meta.unread_count`) and is adjusted
 * locally only between responses. The live event carries no mention id, so it bumps the counter and triggers a
 * refresh that brings the real row. Everything is dropped on any organization change or logout.
 */
export const useMentionsStore = defineStore('mentions', () => {
  const organization = useOrganizationStore()
  const mentions = shallowRef<Mention[]>([])
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
  let controller = new AbortController()
  let live = false
  let stopLive: (() => void) | null = null
  const liveMessages = new Set<number>()
  // Messages whose mention was removed live: a response that started before the removal must not bring the row back.
  const removedMessages = new Set<number>()

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
    liveMessages.clear()
    removedMessages.clear()
    mentions.value = []
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

  function withoutRemoved(rows: readonly Mention[]): Mention[] {
    return removedMessages.size === 0 ? [...rows] : rows.filter((row) => !removedMessages.has(row.message.id))
  }

  /** Loads the first page and merges it into what is already there; the newest request wins. Also the way to reload. */
  function refresh(): Promise<void> {
    if (organization.activeId === null) return Promise.resolve()
    const current = generation
    const version = ++fetchVersion
    loading.value = true
    return listMentions({ perPage: MENTIONS_PER_PAGE }, controller.signal)
      .then((page) => {
        if (current !== generation || version !== fetchVersion) return
        mentions.value = mergeMentions(mentions.value, withoutRemoved(page.data))
        if (!loaded.value) {
          nextCursor.value = page.meta.next_cursor
          loaded.value = true
        }
        setUnread(page.meta.unread_count)
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
      const page = await listMentions({ cursor, perPage: MENTIONS_PER_PAGE }, controller.signal)
      if (current !== generation) return
      // A "mark all" confirmed while this page was in flight covers its (older) rows, which may still arrive unread.
      const rows =
        readAll === readAllVersion
          ? page.data
          : page.data.map((row) => (row.read_at === null ? { ...row, read_at: readAllAt } : row))
      mentions.value = mergeMentions(mentions.value, withoutRemoved(rows))
      nextCursor.value = page.meta.next_cursor
      if (counted === countVersion) setUnread(page.meta.unread_count)
    } catch {
      if (current === generation) loadMoreFailed.value = true
    } finally {
      if (current === generation) loadingMore.value = false
    }
  }

  function setReadAt(ids: ReadonlySet<number>, readAt: string | null): void {
    mentions.value = mentions.value.map((mention) => (ids.has(mention.id) ? { ...mention, read_at: readAt } : mention))
  }

  /** A read confirmed by the server makes a refresh still in flight stale (its count at least): launch a newer one. */
  function invalidateInFlight(): void {
    if (loading.value) void refresh()
  }

  /** Marks the given loaded mentions read, optimistically. Resolves false (state restored, then resynced) if the API fails. */
  async function markRead(targets: Mention | readonly Mention[]): Promise<boolean> {
    const wanted = new Set((Array.isArray(targets) ? targets : [targets]).map((mention: Mention) => mention.id))
    const ids = mentions.value.filter((mention) => wanted.has(mention.id) && mention.read_at === null).map((m) => m.id)
    if (ids.length === 0) return true
    const current = generation
    const flipped = new Set(ids)
    const readAt = new Date().toISOString()
    setReadAt(flipped, readAt)
    setUnread(unreadCount.value - ids.length)
    try {
      let count = unreadCount.value
      for (let i = 0; i < ids.length; i += MENTIONS_READ_MAX_IDS) {
        count = await markMentionsRead({ ids: ids.slice(i, i + MENTIONS_READ_MAX_IDS) })
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
    const flipped = new Set(mentions.value.filter((mention) => mention.read_at === null).map((mention) => mention.id))
    const readAt = new Date().toISOString()
    setReadAt(flipped, readAt)
    setUnread(0)
    try {
      const count = await markMentionsRead({ all: true })
      if (current !== generation) return true
      setReadAt(new Set(mentions.value.filter((m) => m.read_at === null).map((m) => m.id)), readAt)
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

  function onMention(payload: MentionCreatedPayload): void {
    if (payload.organizationId !== organization.activeId) return
    const messageId = payload.message.id
    if (liveMessages.has(messageId) || mentions.value.some((mention) => mention.message.id === messageId)) return
    liveMessages.add(messageId)
    removedMessages.delete(messageId)
    setUnread(unreadCount.value + 1)
    void refresh()
  }

  /** The payload has only ids: drop the row by message id; if it is not loaded the counter is resynced from the API. */
  function onMentionRemoved(payload: MentionRemovedPayload): void {
    if (payload.organizationId !== organization.activeId) return
    const messageId = payload.messageId
    removedMessages.add(messageId)
    liveMessages.delete(messageId)
    const row = mentions.value.find((mention) => mention.message.id === messageId)
    if (row === undefined) {
      void refresh()
      return
    }
    mentions.value = mentions.value.filter((mention) => mention !== row)
    if (row.read_at === null) setUnread(unreadCount.value - 1)
    invalidateInFlight()
  }

  /** Subscribes to `mention.created` and `mention.removed` in the user channel and refreshes on reconnect; call `stop()` on logout or unmount. */
  function start(userId: number): void {
    stop()
    live = true
    const unsubscribeUser = subscribeToUser(userId, { onMention, onMentionRemoved })
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
    mentions,
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
