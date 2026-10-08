import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { api, ApiError } from '../api/client'
import type { CursorPage, Message } from '../api/types'
import { observeStatusMessage, resetGroupStatuses } from '../composables/useLogGroupStatuses'

export const MESSAGES_PER_PAGE = 50
export const CATCH_UP_MAX_PAGES = 10

function indexAfter(list: readonly Message[], id: number): number {
  let low = 0
  let high = list.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (list[middle].id <= id) low = middle + 1
    else high = middle
  }
  return low
}

function mergeById(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const merged: Message[] = []
  let i = 0
  let j = 0
  while (i < current.length || j < incoming.length) {
    const next = j >= incoming.length || (i < current.length && current[i].id <= incoming[j].id) ? current[i++] : incoming[j++]
    if (merged.length === 0 || merged[merged.length - 1].id !== next.id) merged.push(next)
  }
  return merged
}

export const useMessagesStore = defineStore('messages', () => {
  const channelId = ref<number | null>(null)
  const messages = shallowRef<Message[]>([])
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<ApiError | null>(null)
  let generation = 0
  let listVersion = 0
  let pending = new Map<number, Message>()
  let flushScheduled = false

  function has(id: number): boolean {
    if (pending.has(id)) return true
    const index = indexAfter(messages.value, id)
    return index > 0 && messages.value[index - 1].id === id
  }

  function flush(): void {
    flushScheduled = false
    if (pending.size === 0) return
    const incoming = [...pending.values()].sort((a, b) => a.id - b.id)
    pending = new Map()
    messages.value = mergeById(messages.value, incoming)
  }

  function observeAll(list: readonly Message[]): void {
    ;[...list].sort((a, b) => a.id - b.id).forEach(observeStatusMessage)
  }

  function clear(): void {
    generation++
    resetGroupStatuses()
    pending = new Map()
    flushScheduled = false
    channelId.value = null
    messages.value = []
    nextCursor.value = null
    loading.value = false
    loadingMore.value = false
    error.value = null
  }

  function insert(message: Message): boolean {
    if (message.channel_id !== channelId.value) return false
    if (has(message.id)) return false
    observeStatusMessage(message)
    pending.set(message.id, message)
    if (!flushScheduled) {
      flushScheduled = true
      queueMicrotask(flush)
    }
    return true
  }

  async function open(id: number): Promise<void> {
    clear()
    const current = generation
    channelId.value = id
    loading.value = true
    try {
      const page = await api.get<CursorPage<Message>>(`/api/channels/${id}/messages`, {
        query: { per_page: MESSAGES_PER_PAGE },
      })
      if (current !== generation) return
      flush()
      observeAll(page.data)
      const loaded = new Set(page.data.map((message) => message.id))
      const live = messages.value.filter((message) => !loaded.has(message.id))
      messages.value = [...page.data, ...live].sort((a, b) => a.id - b.id)
      nextCursor.value = page.meta.next_cursor
    } catch (caught) {
      if (current !== generation) return
      error.value = caught instanceof ApiError ? caught : new ApiError(0, String(caught))
    } finally {
      if (current === generation) loading.value = false
    }
  }

  async function catchUp(): Promise<void> {
    if (channelId.value === null) return
    flush()
    const current = generation
    const id = channelId.value
    const lastLoadedId = messages.value.length > 0 ? messages.value[messages.value.length - 1].id : null
    const fetched: Message[] = []
    let newest: CursorPage<Message> | null = null
    let joined = false
    try {
      let cursor: string | null = null
      for (let pages = 0; pages < CATCH_UP_MAX_PAGES && !joined; pages++) {
        const page: CursorPage<Message> = await api.get<CursorPage<Message>>(`/api/channels/${id}/messages`, {
          query: cursor === null ? { per_page: MESSAGES_PER_PAGE } : { per_page: MESSAGES_PER_PAGE, cursor },
        })
        if (current !== generation) return
        newest ??= page
        fetched.push(...page.data)
        cursor = page.meta.next_cursor
        joined = lastLoadedId === null || cursor === null || page.data.some((message) => message.id <= lastLoadedId)
      }
    } catch {
      return
    }
    if (joined || newest === null) {
      fetched.forEach(insert)
      flush()
      return
    }
    flush()
    observeAll(newest.data)
    const loaded = new Set(newest.data.map((message) => message.id))
    const oldestId = Math.min(...newest.data.map((message) => message.id))
    const live = messages.value.filter((message) => message.id > oldestId && !loaded.has(message.id))
    messages.value = [...newest.data, ...live].sort((a, b) => a.id - b.id)
    nextCursor.value = newest.meta.next_cursor
    listVersion++
    loadingMore.value = false
  }

  async function loadOlder(): Promise<void> {
    if (channelId.value === null || nextCursor.value === null || loading.value || loadingMore.value) return
    const current = generation
    const version = listVersion
    const id = channelId.value
    loadingMore.value = true
    error.value = null
    try {
      const page = await api.get<CursorPage<Message>>(`/api/channels/${id}/messages`, {
        query: { per_page: MESSAGES_PER_PAGE, cursor: nextCursor.value },
      })
      if (current !== generation || version !== listVersion) return
      flush()
      observeAll(page.data)
      const known = new Set(messages.value.map((message) => message.id))
      const older = page.data.filter((message) => !known.has(message.id)).sort((a, b) => a.id - b.id)
      messages.value = [...older, ...messages.value]
      nextCursor.value = page.meta.next_cursor
    } catch (caught) {
      if (current !== generation || version !== listVersion) return
      error.value = caught instanceof ApiError ? caught : new ApiError(0, String(caught))
    } finally {
      if (current === generation && version === listVersion) loadingMore.value = false
    }
  }

  async function send(body: string): Promise<void> {
    if (channelId.value === null) return
    const current = generation
    const id = channelId.value
    const response = await api.post<{ data: Message }>(`/api/channels/${id}/messages`, { body })
    if (current !== generation) return
    insert(response.data)
    flush()
  }

  return { channelId, messages, nextCursor, loading, loadingMore, error, open, loadOlder, insert, catchUp, send, clear }
})
