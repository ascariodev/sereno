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
  send(body: string): Promise<void>
  clear(): void
}

let generation = 0

const empty = {
  channelId: null,
  messages: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  failed: false,
}

function sortedById(list: Message[]): Message[] {
  return [...list].sort((a, b) => a.id - b.id)
}

export const useMessagesStore = create<MessagesState>()((set, get) => ({
  ...empty,

  async open(channelId) {
    const mine = ++generation
    set({ ...empty, channelId, loading: true })
    try {
      const page = await api.get<MessagesPage>(`/api/channels/${channelId}/messages`, {
        query: { per_page: MESSAGES_PER_PAGE },
      })
      if (mine !== generation) return
      set({ messages: sortedById(page.data), nextCursor: page.meta.next_cursor, loading: false })
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
      const older = sortedById(page.data.filter((message) => !known.has(message.id)))
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
    set({ messages: sortedById([...messages, message]) })
    return true
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
    set({ ...empty })
  },
}))
