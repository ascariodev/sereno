import { create } from 'zustand'

import { api, ApiError } from '@/api/client'
import {
  CATCH_UP_MAX_PAGES,
  isOlderEdit,
  keepNewerContent,
  laterDate,
  MESSAGES_PER_PAGE,
  snapshotCounts,
  useMessagesStore,
  withCounters,
  type Message,
  type MessageDeletedEvent,
  type RootCounters,
} from './store'

interface RepliesPage {
  data: Message[]
  meta: { next_cursor: string | null; root?: Message }
}

interface RootBase {
  root: Message
  bound: string | null
}

interface Removal {
  seq: number
  deletedAt: string
  counters: RootCounters
}

interface ThreadState {
  channelId: number | null
  rootId: number | null
  root: Message | null
  replies: Message[]
  nextCursor: string | null
  loading: boolean
  loadingMore: boolean
  failed: boolean
  notFound: boolean
  open(channelId: number, rootId: number): Promise<void>
  loadOlder(): Promise<void>
  insert(message: Message): boolean
  replace(message: Message): boolean
  remove(event: MessageDeletedEvent): boolean
  catchUp(): Promise<void>
  send(body: string, attachmentIds?: number[]): Promise<void>
  clear(): void
}

const empty = {
  channelId: null,
  rootId: null,
  root: null,
  replies: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  failed: false,
  notFound: false,
}

let removalSeq = 0
let generation = 0
let listVersion = 0
let controller = new AbortController()
let opening: Promise<void> = Promise.resolve()
let openFailed = false
let base: RootBase | null = null
let counted = new Map<number, Message>()
let removed = new Set<number>()
let edits = new Map<number, Message>()
let removal: Removal | null = null
let rootDeletedAt: string | null = null

function resetLiveState(): void {
  openFailed = false
  base = null
  counted = new Map()
  removed = new Set()
  edits = new Map()
  removal = null
  rootDeletedAt = null
}

function asDeleted(message: Message, deletedAt: string): Message {
  return { ...message, body: null, mentions: [], attachments: [], deleted_at: deletedAt }
}

function sortedById(list: Message[]): Message[] {
  return [...list].sort((a, b) => a.id - b.id)
}

function refreshRoot(): void {
  if (base === null) return
  let root = base.root
  for (const reply of counted.values()) {
    if (snapshotCounts(base.bound, reply.created_at)) continue
    root = { ...root, replies_count: root.replies_count + 1, last_reply_at: laterDate(root.last_reply_at, reply.created_at) }
  }
  useThreadStore.setState({ root: rootDeletedAt !== null && root.deleted_at === null ? asDeleted(root, rootDeletedAt) : root })
}

function applyRoot(incoming: Message | undefined, since: number): void {
  if (incoming === undefined || incoming.id !== useThreadStore.getState().rootId) return
  const content = keepNewerContent(incoming, base?.root ?? edits.get(incoming.id))
  base =
    removal !== null && removal.seq > since
      ? { root: withCounters(content, removal.counters), bound: laterDate(removal.counters.last_reply_at, removal.deletedAt) }
      : { root: content, bound: content.last_reply_at }
  refreshRoot()
}

function mergeReplies(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const byId = new Map(current.map((reply) => [reply.id, reply]))
  for (const reply of incoming) byId.set(reply.id, keepNewerContent(reply, byId.get(reply.id) ?? edits.get(reply.id)))
  return sortedById([...byId.values()].filter((reply) => !removed.has(reply.id)))
}

function forget(id: number): void {
  removed.add(id)
  counted.delete(id)
  edits.delete(id)
}

function repliesPath(channelId: number, rootId: number): string {
  return `/api/channels/${channelId}/messages/${rootId}/replies`
}

export const useThreadStore = create<ThreadState>()((set, get) => {
  async function load(current: number, channelId: number, rootId: number, since: number): Promise<void> {
    try {
      const page = await api.get<RepliesPage>(repliesPath(channelId, rootId), {
        query: { per_page: MESSAGES_PER_PAGE },
        signal: controller.signal,
      })
      if (current !== generation) return
      set({ replies: mergeReplies(get().replies, page.data), nextCursor: page.meta.next_cursor })
      applyRoot(page.meta.root, since)
    } catch (error) {
      if (current !== generation) return
      if (!(error instanceof ApiError)) throw error
      openFailed = true
      set({ failed: true, notFound: error.status === 404 })
    } finally {
      if (current === generation) set({ loading: false })
    }
  }

  return {
    ...empty,

    open(channelId, rootId) {
      get().clear()
      set({ channelId, rootId, loading: true })
      opening = load(generation, channelId, rootId, removalSeq)
      return opening
    },

    async loadOlder() {
      const { channelId, rootId, nextCursor, loading, loadingMore } = get()
      if (channelId === null || rootId === null || nextCursor === null || loading || loadingMore) return
      const current = generation
      const version = listVersion
      const since = removalSeq
      set({ loadingMore: true, failed: false })
      try {
        const page = await api.get<RepliesPage>(repliesPath(channelId, rootId), {
          query: { per_page: MESSAGES_PER_PAGE, cursor: nextCursor },
          signal: controller.signal,
        })
        if (current !== generation || version !== listVersion) return
        set({ replies: mergeReplies(get().replies, page.data), nextCursor: page.meta.next_cursor })
        applyRoot(page.meta.root, since)
      } catch (error) {
        if (current !== generation || version !== listVersion) return
        if (!(error instanceof ApiError)) throw error
        set({ failed: true })
      } finally {
        if (current === generation && version === listVersion) set({ loadingMore: false })
      }
    },

    insert(message) {
      const { rootId, channelId, replies } = get()
      if (rootId === null || message.channel_id !== channelId || message.parent_id !== rootId) return false
      if (removed.has(message.id) || replies.some((reply) => reply.id === message.id)) return false
      set({ replies: mergeReplies(replies, [message]) })
      counted.set(message.id, message)
      refreshRoot()
      return true
    },

    replace(message) {
      const { rootId, channelId, replies } = get()
      if (rootId === null || message.channel_id !== channelId) return false
      const isRoot = message.id === rootId
      if (!isRoot && (message.parent_id !== rootId || removed.has(message.id))) return false
      if (isRoot && rootDeletedAt !== null) return false
      const known = edits.get(message.id)
      if (known !== undefined && isOlderEdit(message, known)) return false
      const current = isRoot ? base?.root : replies.find((reply) => reply.id === message.id)
      if (current !== undefined && (current.deleted_at !== null || isOlderEdit(message, current))) return false
      edits.set(message.id, message)
      if (current === undefined) return false
      if (isRoot && base !== null) {
        const root = { ...message, replies_count: current.replies_count, last_reply_at: current.last_reply_at, recent_participants: current.recent_participants }
        base = { ...base, root }
        refreshRoot()
      } else {
        set({ replies: replies.map((reply) => (reply.id === message.id ? message : reply)) })
      }
      return true
    },

    remove(event) {
      const { rootId, channelId } = get()
      const counters = event.root
      if (rootId === null || event.channel_id !== channelId || counters === undefined || counters.id !== rootId) return false
      if (event.parent_id === null && event.id !== rootId) return false
      removal = { seq: ++removalSeq, deletedAt: event.deleted_at, counters }
      if (event.parent_id === null) rootDeletedAt = event.deleted_at
      else {
        forget(event.id)
        set({ replies: get().replies.filter((reply) => reply.id !== event.id) })
      }
      if (base !== null) {
        base = { root: withCounters(base.root, counters), bound: laterDate(counters.last_reply_at, event.deleted_at) }
      }
      refreshRoot()
      return true
    },

    async catchUp() {
      if (get().channelId === null || get().rootId === null) return
      const current = generation
      await opening
      if (current !== generation || openFailed) return
      const channelId = get().channelId as number
      const rootId = get().rootId as number
      const since = removalSeq
      const replies = get().replies
      const lastLoadedId = replies.length > 0 ? replies[replies.length - 1].id : null
      const startIds = new Set(replies.map((reply) => reply.id))
      const fetched: Message[] = []
      let newest: RepliesPage | null = null
      let joined = false
      let cursor: string | null = null
      try {
        for (let pages = 0; pages < CATCH_UP_MAX_PAGES && !joined; pages++) {
          const page: RepliesPage = await api.get<RepliesPage>(repliesPath(channelId, rootId), {
            query: cursor === null ? { per_page: MESSAGES_PER_PAGE } : { per_page: MESSAGES_PER_PAGE, cursor },
            signal: controller.signal,
          })
          if (current !== generation) return
          newest ??= page
          fetched.push(...page.data)
          cursor = page.meta.next_cursor
          joined = lastLoadedId === null || cursor === null || page.data.some((reply) => reply.id <= lastLoadedId)
        }
      } catch (error) {
        if (!(error instanceof ApiError) && !(error instanceof Error && error.name === 'AbortError')) throw error
        return
      }
      if (newest === null) return
      applyRoot(newest.meta.root, since)
      const covered = joined ? fetched : newest.data
      const coveredIds = new Set(covered.map((reply) => reply.id))
      const upper = Math.max(lastLoadedId ?? -Infinity, ...coveredIds)
      const lower = joined && cursor === null ? -Infinity : Math.min(...coveredIds)
      for (const id of startIds) if (id >= lower && id <= upper && !coveredIds.has(id)) forget(id)
      if (joined) {
        set({ replies: mergeReplies(get().replies, fetched) })
        return
      }
      const oldestId = Math.min(...newest.data.map((reply) => reply.id))
      set({
        replies: mergeReplies(
          get().replies.filter((reply) => reply.id > oldestId),
          newest.data,
        ),
        nextCursor: newest.meta.next_cursor,
        loadingMore: false,
      })
      listVersion++
    },

    async send(body, attachmentIds = []) {
      const { channelId, rootId } = get()
      if (channelId === null || rootId === null) return
      const current = generation
      const response = await api.post<{ data: Message }>(`/api/channels/${channelId}/messages`, {
        body,
        parent_id: rootId,
        ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
      })
      useMessagesStore.getState().insert(response.data)
      if (current !== generation) return
      get().insert(response.data)
    },

    clear() {
      generation++
      controller.abort()
      controller = new AbortController()
      opening = Promise.resolve()
      resetLiveState()
      set({ ...empty })
    },
  }
})
