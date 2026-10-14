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
  replies_count: number
  last_reply_at: string | null
  recent_participants: { id: number; name: string }[]
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

export interface RootCounters {
  id: number
  replies_count: number
  last_reply_at: string | null
  recent_participants?: { id: number; name: string }[]
}

export interface MessageDeletedEvent {
  id: number
  channel_id: number
  parent_id: number | null
  deleted_at: string
  root?: RootCounters
}

const MAX_PARTICIPANTS = 3

function laterDate(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return Date.parse(b) > Date.parse(a) ? b : a
}

export function snapshotCounts(snapshotLast: string | null | undefined, at: string): boolean {
  return snapshotLast != null && Date.parse(at) <= Date.parse(snapshotLast)
}

function withParticipant(current: Message['recent_participants'], author: Message['user']): Message['recent_participants'] {
  if (author === null) return current
  return [author, ...current.filter((user) => user.id !== author.id)].slice(0, MAX_PARTICIPANTS)
}

function bumpRoot(root: Message, reply: Message): Message {
  return {
    ...root,
    replies_count: root.replies_count + 1,
    last_reply_at: laterDate(root.last_reply_at, reply.created_at),
    recent_participants: withParticipant(root.recent_participants, reply.user),
  }
}

function withCounters(root: Message, counters: RootCounters): Message {
  return {
    ...root,
    replies_count: counters.replies_count,
    last_reply_at: counters.last_reply_at,
    recent_participants: counters.recent_participants ?? root.recent_participants,
  }
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
let removalSeq = 0

interface Removal {
  seq: number
  deletedAt: string
  counters?: RootCounters
}

// Live replies already applied; they reconcile later snapshots of their root.
let countedReplies = new Map<number, Message>()
// last_reply_at of the latest server snapshot of each root.
let snapshots = new Map<number, string | null>()
// Latest live deletion that touched each root.
let removals = new Map<number, Removal>()
// Roots deleted in live: they stay as a marker only while they have replies.
let deletedRoots = new Map<number, string>()
let removedReplies = new Set<number>()

const empty = {
  channelId: null,
  messages: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  failed: false,
}

function isOlderEdit(incoming: Message, current: Message): boolean {
  return incoming.edited_at !== null && current.edited_at !== null && Date.parse(incoming.edited_at) < Date.parse(current.edited_at)
}

function keepNewerContent(incoming: Message, current: Message | undefined): Message {
  if (current === undefined || current.deleted_at !== null || incoming.deleted_at !== null || current.edited_at === null) return incoming
  if (incoming.edited_at !== null && Date.parse(incoming.edited_at) >= Date.parse(current.edited_at)) return incoming
  return {
    ...current,
    replies_count: incoming.replies_count,
    last_reply_at: incoming.last_reply_at,
    recent_participants: incoming.recent_participants,
  }
}

function resetLiveState(): void {
  countedReplies = new Map()
  snapshots = new Map()
  removals = new Map()
  deletedRoots = new Map()
  removedReplies = new Set()
}

function withLiveReplies(root: Message, bound: string | null): Message {
  snapshots.set(root.id, bound)
  let result = root
  for (const reply of countedReplies.values()) {
    if (reply.parent_id === root.id && !snapshotCounts(bound, reply.created_at)) result = bumpRoot(result, reply)
  }
  return result
}

function rebase(root: Message, removal: Removal): Message {
  if (removal.counters === undefined) return root
  return withLiveReplies(withCounters(root, removal.counters), laterDate(removal.counters.last_reply_at, removal.deletedAt))
}

function removalAfter(rootId: number, since: number): Removal | undefined {
  const removal = removals.get(rootId)
  return removal !== undefined && removal.seq > since ? removal : undefined
}

function reconcile(root: Message, since: number): Message {
  const removal = removalAfter(root.id, since)
  return removal !== undefined ? rebase(root, removal) : withLiveReplies(root, root.last_reply_at)
}

function settle(root: Message): Message | null {
  const deletedAt = deletedRoots.get(root.id)
  if (deletedAt === undefined) return root
  if (root.replies_count === 0) return null
  return root.deleted_at !== null ? root : { ...root, body: null, mentions: [], deleted_at: deletedAt }
}

function fromServer(list: Message[], since: number): Message[] {
  return list.flatMap((message) => {
    if (message.parent_id !== null) return []
    const settled = settle(reconcile(message, since))
    return settled === null ? [] : [settled]
  })
}

function updateRoot(id: number, change: (message: Message) => Message | null): boolean {
  const { messages } = useMessagesStore.getState()
  const index = messages.findIndex((known) => known.id === id)
  if (index < 0) return false
  const next = messages.slice()
  const changed = change(next[index])
  if (changed === null) next.splice(index, 1)
  else next[index] = changed
  useMessagesStore.setState({ messages: next })
  return true
}

function sortedById(list: Message[]): Message[] {
  return [...list].sort((a, b) => a.id - b.id)
}

function applyReply(reply: Message, rootId: number): boolean {
  if (countedReplies.has(reply.id) || removedReplies.has(reply.id)) return false
  countedReplies.set(reply.id, reply)
  if (snapshotCounts(snapshots.get(rootId), reply.created_at)) return true
  updateRoot(rootId, (root) => bumpRoot(root, reply))
  return true
}

export const useMessagesStore = create<MessagesState>()((set, get) => ({
  ...empty,

  async open(channelId) {
    const mine = ++generation
    const since = removalSeq
    resetLiveState()
    set({ ...empty, channelId, loading: true })
    try {
      const page = await api.get<MessagesPage>(`/api/channels/${channelId}/messages`, {
        query: { per_page: MESSAGES_PER_PAGE },
      })
      if (mine !== generation) return
      const live = get().messages.filter((message) => !page.data.some((loaded) => loaded.id === message.id))
      set({ messages: sortedById([...fromServer(page.data, since), ...live]), nextCursor: page.meta.next_cursor, loading: false })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (mine === generation) set({ failed: true, loading: false })
    }
  },

  async loadOlder() {
    const { channelId, nextCursor, loading, loadingMore } = get()
    if (channelId === null || nextCursor === null || loading || loadingMore) return
    const mine = generation
    const since = removalSeq
    set({ loadingMore: true, failed: false })
    try {
      const page = await api.get<MessagesPage>(`/api/channels/${channelId}/messages`, {
        query: { per_page: MESSAGES_PER_PAGE, cursor: nextCursor },
      })
      if (mine !== generation) return
      const known = new Set(get().messages.map((message) => message.id))
      const older = sortedById(fromServer(page.data, since).filter((message) => !known.has(message.id)))
      set({ messages: [...older, ...get().messages], nextCursor: page.meta.next_cursor, loadingMore: false })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (mine === generation) set({ failed: true, loadingMore: false })
    }
  },

  insert(message) {
    const { channelId, messages } = get()
    if (channelId === null || message.channel_id !== channelId) return false
    if (message.parent_id !== null) return applyReply(message, message.parent_id)
    if (messages.some((known) => known.id === message.id)) return false
    let incoming: Message | null = message
    if (deletedRoots.has(message.id)) {
      if (message.deleted_at !== null) return false
      const early = removals.get(message.id)
      incoming = settle(early !== undefined ? rebase(message, early) : message)
    }
    if (incoming === null) return false
    set({ messages: sortedById([...messages, incoming]) })
    return true
  },

  replace(message) {
    const { channelId, messages } = get()
    if (channelId === null || message.channel_id !== channelId || message.parent_id !== null) return false
    const current = messages.find((known) => known.id === message.id)
    if (!current || current.deleted_at !== null || deletedRoots.has(message.id) || isOlderEdit(message, current)) return false
    const next = {
      ...message,
      replies_count: current.replies_count,
      last_reply_at: current.last_reply_at,
      recent_participants: current.recent_participants,
    }
    set({ messages: messages.map((known) => (known.id === message.id ? next : known)) })
    return true
  },

  remove(event) {
    const { channelId } = get()
    if (channelId === null || event.channel_id !== channelId) return false
    const rootId = event.parent_id ?? event.id
    const counters = event.root
    const next: Removal = { seq: ++removalSeq, deletedAt: event.deleted_at, counters }
    const previous = removals.get(rootId)
    const effective = previous !== undefined && Date.parse(previous.deletedAt) > Date.parse(event.deleted_at) ? previous : next
    removals.set(rootId, effective)
    if (event.parent_id === null) {
      deletedRoots.set(event.id, event.deleted_at)
      if (deletedRoots.size > MAX_LIVE_DELETIONS) deletedRoots.delete(deletedRoots.keys().next().value as number)
    } else {
      removedReplies.add(event.id)
      countedReplies.delete(event.id)
    }
    if (counters !== undefined) snapshots.set(rootId, laterDate(counters.last_reply_at, event.deleted_at))
    return updateRoot(rootId, (root) => settle(rebase(root, effective)))
  },

  async catchUp() {
    const { channelId, loading } = get()
    if (channelId === null || loading) return
    const mine = generation
    const since = removalSeq
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
    const rawRoots = fetched.filter((message) => message.parent_id === null)
    const current = new Map(get().messages.map((message) => [message.id, message]))
    if (!joined) {
      const oldest = Math.min(...rawRoots.map((message) => message.id))
      const live = [...current.values()].filter((message) => message.id > oldest && !rawRoots.some((root) => root.id === message.id))
      const fresh = fromServer(rawRoots, since).map((message) => keepNewerContent(message, current.get(message.id)))
      set({ messages: sortedById([...fresh, ...live]), nextCursor: newestCursor })
      return
    }
    const fetchedIds = new Set(rawRoots.map((message) => message.id))
    const upper = Math.max(lastLoadedId ?? -Infinity, ...fetchedIds)
    const lower = cursor === null ? -Infinity : Math.min(...fetchedIds)
    const merged = new Map<number, Message>()
    for (const message of get().messages) {
      const gone = startIds.has(message.id) && message.id >= lower && message.id <= upper && !fetchedIds.has(message.id)
      if (!gone) merged.set(message.id, message)
    }
    const settledIds = new Set<number>()
    for (const message of fromServer(rawRoots, since)) {
      settledIds.add(message.id)
      merged.set(message.id, keepNewerContent(message, merged.get(message.id)))
    }
    for (const message of rawRoots) if (!settledIds.has(message.id)) merged.delete(message.id)
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
    resetLiveState()
    set({ ...empty })
  },
}))
