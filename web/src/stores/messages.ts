import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { api, ApiError } from '../api/client'
import type { CursorPage, Message, MessageDeletedEvent, RootCounters } from '../api/types'
import { laterDate } from '../laterDate'
import { resetHourlyCounts } from '../composables/useHourlyCounts'
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

/** Both lists sorted by id; on the same id the incoming version wins (fresher reply counters). */
function mergeById(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const merged: Message[] = []
  let i = 0
  let j = 0
  while (i < current.length || j < incoming.length) {
    if (i < current.length && j < incoming.length && current[i].id === incoming[j].id) i++
    const next = j >= incoming.length || (i < current.length && current[i].id < incoming[j].id) ? current[i++] : incoming[j++]
    if (merged.length > 0 && merged[merged.length - 1].id === next.id) merged[merged.length - 1] = next
    else merged.push(next)
  }
  return merged
}

const MAX_PARTICIPANTS = 3

/** Puts the reply author first, once, keeping the newest `MAX_PARTICIPANTS`. */
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

/** Whether the incoming version carries an edit older than the one already applied in live. */
export function isOlderEdit(incoming: Message, current: Message): boolean {
  return incoming.edited_at !== null && current.edited_at !== null && Date.parse(incoming.edited_at) < Date.parse(current.edited_at)
}

/** A server version whose content predates the edit already applied in live (late snapshot). */
function hasOlderContent(incoming: Message, current: Message): boolean {
  if (current.edited_at === null || incoming.deleted_at !== null) return false
  return incoming.edited_at === null || Date.parse(incoming.edited_at) < Date.parse(current.edited_at)
}

/** Takes the counters of the server version and the content of the live one when the server one is older. */
export function keepNewerContent(incoming: Message, current: Message | undefined): Message {
  if (current === undefined || current.deleted_at !== null || !hasOlderContent(incoming, current)) return incoming
  return {
    ...current,
    replies_count: incoming.replies_count,
    last_reply_at: incoming.last_reply_at,
    recent_participants: incoming.recent_participants,
  }
}

/** Whether a server snapshot of a root, with this `last_reply_at`, already counts a reply created at `at`. */
export function snapshotCounts(snapshotLast: string | null | undefined, at: string): boolean {
  return snapshotLast != null && Date.parse(at) <= Date.parse(snapshotLast)
}

/** A deletion applied in live: the root counters of its event are authoritative as of `deletedAt`. */
interface Removal {
  seq: number
  deletedAt: string
  counters: RootCounters
}

export function withCounters(root: Message, counters: RootCounters): Message {
  return { ...root, replies_count: counters.replies_count, last_reply_at: counters.last_reply_at }
}

export function asDeleted(message: Message, deletedAt: string): Message {
  return { ...message, body: null, mentions: [], attachments: [], deleted_at: deletedAt }
}

let removalSeq = 0

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
  /** Live replies already applied, by id; they reconcile later snapshots of their root. */
  let countedReplies = new Map<number, Message>()
  /** `last_reply_at` of the latest server snapshot of each root, to tell whether a late live reply is in it. */
  let snapshots = new Map<number, string | null>()
  /** Latest live deletion that touched the counters of each root. */
  let removals = new Map<number, Removal>()
  /** Roots deleted in live, with their `deleted_at`: they stay as a marker only while they have replies. */
  let deletedRoots = new Map<number, string>()
  /** Replies deleted in live; a late `created` of one of them must not count. */
  let removedReplies = new Set<number>()
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
    resetHourlyCounts()
    pending = new Map()
    countedReplies = new Map()
    snapshots = new Map()
    removals = new Map()
    deletedRoots = new Map()
    removedReplies = new Set()
    flushScheduled = false
    channelId.value = null
    messages.value = []
    nextCursor.value = null
    loading.value = false
    loadingMore.value = false
    error.value = null
  }

  /** Adds the live replies created after `bound`, the moment up to which the counters of `root` are known. */
  function withLiveReplies(root: Message, bound: string | null): Message {
    snapshots.set(root.id, bound)
    let result = root
    for (const reply of countedReplies.values()) {
      if (reply.parent_id === root.id && !snapshotCounts(bound, reply.created_at)) result = bumpRoot(result, reply)
    }
    return result
  }

  function rebase(root: Message, removal: Removal): Message {
    return withLiveReplies(withCounters(root, removal.counters), laterDate(removal.counters.last_reply_at, removal.deletedAt))
  }

  /** Whether a live deletion applied after the load that started at `since` makes its snapshot of this root stale. */
  function removalAfter(rootId: number, since: number): Removal | undefined {
    const removal = removals.get(rootId)
    return removal !== undefined && removal.seq > since ? removal : undefined
  }

  /** Takes a root from the server and adds the live replies its snapshot does not include yet. */
  function reconcile(root: Message, since: number): Message {
    const removal = removalAfter(root.id, since)
    return removal !== undefined ? rebase(root, removal) : withLiveReplies(root, root.last_reply_at)
  }

  /** A deleted root becomes a marker while it has replies and leaves the list without them. */
  function settle(root: Message): Message | null {
    const deletedAt = deletedRoots.get(root.id)
    if (deletedAt === undefined) return root
    return root.replies_count > 0 ? asDeleted(root, deletedAt) : null
  }

  /** A page loaded since `since`, without the live deletions it may predate; counters stay those of the page otherwise. */
  function fromServer(list: readonly Message[], since: number): Message[] {
    return list.flatMap((message) => {
      if (message.parent_id !== null) return [message]
      const removal = removalAfter(message.id, since)
      const settled = settle(removal !== undefined ? withCounters(message, removal.counters) : message)
      return settled === null ? [] : [settled]
    })
  }

  /** Applies `change` to a loaded root (queued or in the list); `null` takes it out. False if it is not loaded. */
  function update(id: number, change: (message: Message) => Message | null): boolean {
    const queued = pending.get(id)
    if (queued !== undefined) {
      const next = change(queued)
      if (next === null) pending.delete(id)
      else pending.set(id, next)
      return true
    }
    const index = indexAfter(messages.value, id) - 1
    if (index < 0 || messages.value[index].id !== id) return false
    const next = messages.value.slice()
    const changed = change(next[index])
    if (changed === null) next.splice(index, 1)
    else next[index] = changed
    messages.value = next
    return true
  }

  function applyReply(reply: Message, rootId: number): boolean {
    if (countedReplies.has(reply.id) || removedReplies.has(reply.id)) return false
    countedReplies.set(reply.id, reply)
    if (snapshotCounts(snapshots.get(rootId), reply.created_at)) return true
    const bump = (root: Message): Message => bumpRoot(root, reply)
    const queued = pending.get(rootId)
    if (queued !== undefined) {
      pending.set(rootId, bump(queued))
      return true
    }
    const index = indexAfter(messages.value, rootId) - 1
    if (index >= 0 && messages.value[index].id === rootId) {
      const next = messages.value.slice()
      next[index] = bump(next[index])
      messages.value = next
    }
    return true
  }

  function insert(message: Message): boolean {
    if (message.channel_id !== channelId.value) return false
    if (message.parent_id !== null) return applyReply(message, message.parent_id)
    if (has(message.id) || deletedRoots.has(message.id)) return false
    observeStatusMessage(message)
    pending.set(message.id, message)
    if (!flushScheduled) {
      flushScheduled = true
      queueMicrotask(flush)
    }
    return true
  }

  /** An edit in live: takes the content and keeps the local thread counters. Ignores replies and unloaded roots. */
  function replace(message: Message): boolean {
    if (message.channel_id !== channelId.value || message.parent_id !== null || deletedRoots.has(message.id)) return false
    let applied = false
    update(message.id, (current) => {
      if (current.deleted_at !== null || isOlderEdit(message, current)) return current
      applied = true
      return {
        ...message,
        replies_count: current.replies_count,
        last_reply_at: current.last_reply_at,
        recent_participants: current.recent_participants,
      }
    })
    return applied
  }

  /** A deletion in live: takes the root counters of the event even if they go down; never inserts. */
  function remove(event: MessageDeletedEvent): boolean {
    if (event.channel_id !== channelId.value) return false
    const previous = removals.get(event.root.id)
    const removal: Removal = { seq: ++removalSeq, deletedAt: event.deleted_at, counters: event.root }
    const effective = previous !== undefined && Date.parse(previous.deletedAt) > Date.parse(event.deleted_at) ? previous : removal
    removals.set(event.root.id, effective)
    if (event.parent_id === null) deletedRoots.set(event.id, event.deleted_at)
    else {
      removedReplies.add(event.id)
      countedReplies.delete(event.id)
    }
    snapshots.set(event.root.id, laterDate(event.root.last_reply_at, event.deleted_at))
    return update(event.root.id, (root) => settle(rebase(root, effective)))
  }

  async function open(id: number): Promise<void> {
    clear()
    const current = generation
    const since = removalSeq
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
      messages.value = [...fromServer(page.data, since), ...live].sort((a, b) => a.id - b.id)
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
    const since = removalSeq
    const id = channelId.value
    const lastLoadedId = messages.value.length > 0 ? messages.value[messages.value.length - 1].id : null
    const startIds = new Set(messages.value.map((message) => message.id))
    const fetched: Message[] = []
    let newest: CursorPage<Message> | null = null
    let joined = false
    let cursor: string | null = null
    try {
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
      flush()
      const known = new Set(messages.value.map((message) => message.id))
      const currentById = new Map(messages.value.map((message) => [message.id, message]))
      const reconciled = fetched.flatMap((message) => {
        if (message.parent_id !== null) return [message]
        const settled = settle(reconcile(message, since))
        return settled === null ? [] : [keepNewerContent(settled, currentById.get(settled.id))]
      })
      const refreshed = reconciled.filter((message) => known.has(message.id)).sort((a, b) => a.id - b.id)
      reconciled.filter((message) => !known.has(message.id)).forEach(insert)
      // The pages cover [lower, upper]: what was loaded at the start inside it and did not come was deleted.
      const fetchedIds = new Set(fetched.map((message) => message.id))
      const upper = Math.max(lastLoadedId ?? -Infinity, ...fetchedIds)
      const lower = cursor === null ? -Infinity : Math.min(...fetchedIds)
      const gone = (message: Message): boolean =>
        startIds.has(message.id) && message.id >= lower && message.id <= upper && !fetchedIds.has(message.id)
      const kept = messages.value.some(gone) ? messages.value.filter((message) => !gone(message)) : messages.value
      messages.value = refreshed.length > 0 ? mergeById(kept, refreshed) : kept
      flush()
      return
    }
    flush()
    observeAll(newest.data)
    const loaded = new Set(newest.data.map((message) => message.id))
    const oldestId = Math.min(...newest.data.map((message) => message.id))
    const live = messages.value.filter((message) => message.id > oldestId && !loaded.has(message.id))
    const currentById = new Map(messages.value.map((message) => [message.id, message]))
    const fresh = fromServer(newest.data, since).map((message) => keepNewerContent(message, currentById.get(message.id)))
    messages.value = [...fresh, ...live].sort((a, b) => a.id - b.id)
    nextCursor.value = newest.meta.next_cursor
    listVersion++
    loadingMore.value = false
  }

  async function loadOlder(): Promise<void> {
    if (channelId.value === null || nextCursor.value === null || loading.value || loadingMore.value) return
    const current = generation
    const version = listVersion
    const since = removalSeq
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
      const older = fromServer(page.data, since).filter((message) => !known.has(message.id)).sort((a, b) => a.id - b.id)
      messages.value = [...older, ...messages.value]
      nextCursor.value = page.meta.next_cursor
    } catch (caught) {
      if (current !== generation || version !== listVersion) return
      error.value = caught instanceof ApiError ? caught : new ApiError(0, String(caught))
    } finally {
      if (current === generation && version === listVersion) loadingMore.value = false
    }
  }

  async function send(body: string, attachmentIds: number[] = []): Promise<void> {
    if (channelId.value === null) return
    const current = generation
    const id = channelId.value
    const response = await api.post<{ data: Message }>(`/api/channels/${id}/messages`, {
      body,
      ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
    })
    if (current !== generation) return
    insert(response.data)
    flush()
  }

  return { channelId, messages, nextCursor, loading, loadingMore, error, open, loadOlder, insert, replace, remove, catchUp, send, clear }
})
