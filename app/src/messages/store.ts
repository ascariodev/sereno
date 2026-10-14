import { create } from 'zustand'

import { api, ApiError } from '@/api/client'
import type { MessagePayload } from './payload'

export const MESSAGES_PER_PAGE = 50

export interface Message {
  id: number
  channel_id: number
  kind: 'user' | 'system'
  body: string | null
  payload: MessagePayload | null
  parent_id: number | null
  user: { id: number; name: string } | null
  mentions: { id: number; name: string }[]
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

interface MessagesPage {
  data: Message[]
  meta: { next_cursor: string | null }
}

export interface MessageDeletedEvent {
  id: number
  channel_id: number
  parent_id: number | null
  deleted_at: string
}

interface MessagesState {
  channelId: number | null
  messages: Message[]
  nextCursor: string | null
  loading: boolean
  loadingMore: boolean
  failed: boolean
  open(channelId: number): Promise<void>
  loadOlder(): Promise<void>
  insert(message: Message): boolean
  replace(message: Message): boolean
  remove(event: MessageDeletedEvent): boolean
  catchUp(): Promise<void>
  send(body: string): Promise<void>
  clear(): void
}

export const CATCH_UP_MAX_PAGES = 10
const MAX_LIVE_DELETIONS = 200

let generation = 0
// Roots deleted in live: a snapshot that predates the deletion must not bring them back.
let liveDeletions = new Map<number, string>()

const empty = {
  channelId: null,
  messages: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  failed: false,
}

function withLiveDeletion(message: Message): Message {
  const deletedAt = liveDeletions.get(message.id)
  return deletedAt !== undefined && message.deleted_at === null ? { ...message, deleted_at: deletedAt } : message
}

function isOlderEdit(incoming: Message, current: Message): boolean {
  return incoming.edited_at !== null && current.edited_at !== null && Date.parse(incoming.edited_at) < Date.parse(current.edited_at)
}

function keepsNewerContent(incoming: Message, current: Message | undefined): boolean {
  if (current === undefined || current.deleted_at !== null || incoming.deleted_at !== null || current.edited_at === null) return false
  return incoming.edited_at === null || Date.parse(incoming.edited_at) < Date.parse(current.edited_at)
}

function sortedById(list: Message[]): Message[] {
  return [...list].sort((a, b) => a.id - b.id)
}

export const useMessagesStore = create<MessagesState>()((set, get) => ({
  ...empty,

  async open(channelId) {
    const mine = ++generation
    liveDeletions = new Map()
    set({ ...empty, channelId, loading: true })
    try {
      const page = await api.get<MessagesPage>(`/api/channels/${channelId}/messages`, {
        query: { per_page: MESSAGES_PER_PAGE },
      })
      if (mine !== generation) return
      const live = get().messages.filter((message) => !page.data.some((loaded) => loaded.id === message.id))
      set({ messages: sortedById([...page.data.map(withLiveDeletion), ...live]), nextCursor: page.meta.next_cursor, loading: false })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (mine === generation) set({ failed: true, loading: false })
    }
  },

  async loadOlder() {
    const { channelId, nextCursor, loading, loadingMore } = get()
    if (channelId === null || nextCursor === null || loading || loadingMore) return
    const mine = generation
    set({ loadingMore: true, failed: false })
    try {
      const page = await api.get<MessagesPage>(`/api/channels/${channelId}/messages`, {
        query: { per_page: MESSAGES_PER_PAGE, cursor: nextCursor },
      })
      if (mine !== generation) return
      const known = new Set(get().messages.map((message) => message.id))
      const older = sortedById(page.data.filter((message) => !known.has(message.id)).map(withLiveDeletion))
      set({ messages: [...older, ...get().messages], nextCursor: page.meta.next_cursor, loadingMore: false })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (mine === generation) set({ failed: true, loadingMore: false })
    }
  },

  insert(message) {
    const { channelId, messages } = get()
    if (channelId === null || message.channel_id !== channelId || message.parent_id !== null) return false
    if (messages.some((known) => known.id === message.id)) return false
    set({ messages: sortedById([...messages, withLiveDeletion(message)]) })
    return true
  },

  replace(message) {
    const { channelId, messages } = get()
    if (channelId === null || message.channel_id !== channelId || message.parent_id !== null) return false
    const current = messages.find((known) => known.id === message.id)
    if (!current || current.deleted_at !== null || liveDeletions.has(message.id) || isOlderEdit(message, current)) return false
    set({ messages: messages.map((known) => (known.id === message.id ? message : known)) })
    return true
  },

  remove(event) {
    const { channelId, messages } = get()
    if (channelId === null || event.channel_id !== channelId || event.parent_id !== null) return false
    liveDeletions.set(event.id, event.deleted_at)
    if (liveDeletions.size > MAX_LIVE_DELETIONS) liveDeletions.delete(liveDeletions.keys().next().value as number)
    if (!messages.some((known) => known.id === event.id)) return false
    set({
      messages: messages.map((known) =>
        known.id === event.id && known.deleted_at === null ? { ...known, deleted_at: event.deleted_at } : known,
      ),
    })
    return true
  },

  async catchUp() {
    const { channelId, loading } = get()
    if (channelId === null || loading) return
    const mine = generation
    const lastLoadedId = get().messages.at(-1)?.id ?? null
    const startIds = new Set(get().messages.map((message) => message.id))
    const fetched: Message[] = []
    let newestCursor: string | null = null
    let cursor: string | null = null
    let joined = false
    try {
      for (let pages = 0; pages < CATCH_UP_MAX_PAGES && !joined; pages++) {
        const page: MessagesPage = await api.get<MessagesPage>(`/api/channels/${channelId}/messages`, {
          query: cursor === null ? { per_page: MESSAGES_PER_PAGE } : { per_page: MESSAGES_PER_PAGE, cursor },
        })
        if (mine !== generation) return
        if (pages === 0) newestCursor = page.meta.next_cursor
        fetched.push(...page.data)
        cursor = page.meta.next_cursor
        joined = lastLoadedId === null || cursor === null || page.data.some((message) => message.id <= lastLoadedId)
      }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      return
    }
    const roots = fetched.filter((message) => message.parent_id === null).map(withLiveDeletion)
    const current = new Map(get().messages.map((message) => [message.id, message]))
    if (!joined) {
      const oldest = Math.min(...roots.map((message) => message.id))
      const live = [...current.values()].filter((message) => message.id > oldest && !roots.some((root) => root.id === message.id))
      const fresh = roots.map((message) => (keepsNewerContent(message, current.get(message.id)) ? current.get(message.id)! : message))
      set({ messages: sortedById([...fresh, ...live]), nextCursor: newestCursor })
      return
    }
    const fetchedIds = new Set(roots.map((message) => message.id))
    const upper = Math.max(lastLoadedId ?? -Infinity, ...fetchedIds)
    const lower = cursor === null ? -Infinity : Math.min(...fetchedIds)
    const merged = new Map<number, Message>()
    for (const message of get().messages) {
      const gone = startIds.has(message.id) && message.id >= lower && message.id <= upper && !fetchedIds.has(message.id)
      if (!gone) merged.set(message.id, message)
    }
    for (const message of roots) {
      const known = merged.get(message.id)
      merged.set(message.id, known && keepsNewerContent(message, known) ? known : message)
    }
    set({ messages: sortedById([...merged.values()]) })
  },

  async send(body) {
    const { channelId } = get()
    if (channelId === null) return
    const mine = generation
    const response = await api.post<{ data: Message }>(`/api/channels/${channelId}/messages`, { body })
    if (mine !== generation) return
    get().insert(response.data)
  },

  clear() {
    generation++
    liveDeletions = new Map()
    set({ ...empty })
  },
}))
