import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { ApiError } from '../api/client'
import { listReplies, sendReply } from '../api/messages'
import type { Message, MessageDeletedEvent, RepliesPage, RootCounters } from '../api/types'
import type { MentionDraft } from '../composables/useMentionInput'
import { laterDate } from '../laterDate'
import {
  asDeleted,
  CATCH_UP_MAX_PAGES,
  isOlderEdit,
  keepNewerContent,
  MESSAGES_PER_PAGE,
  snapshotCounts,
  useMessagesStore,
  withCounters,
} from './messages'

function toApiError(caught: unknown): ApiError {
  return caught instanceof ApiError ? caught : new ApiError(0, String(caught))
}

/** Root counters known up to `bound`; live replies created later are added on top. */
interface RootBase {
  root: Message
  bound: string | null
}

/** A deletion applied in live: its root counters are authoritative as of `deletedAt`. */
interface Removal {
  seq: number
  deletedAt: string
  counters: RootCounters
}

let removalSeq = 0

export const useThreadStore = defineStore('thread', () => {
  const channelId = ref<number | null>(null)
  const rootId = ref<number | null>(null)
  const replies = shallowRef<Message[]>([])
  /** Root from the replies API, a fallback for roots outside the loaded channel page. */
  const threadRoot = shallowRef<Message | null>(null)
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<ApiError | null>(null)
  /** Unsent reply of the open thread; survives `open` of the same root (the panel remounts across the breakpoint). */
  const draft = shallowRef<(MentionDraft & { rootId: number }) | null>(null)
  let generation = 0
  let listVersion = 0
  let controller = new AbortController()
  let opening: Promise<void> = Promise.resolve()
  let openFailed = false
  let base: RootBase | null = null
  /** Live replies, by id; they count on top of the root counters when created after their bound. */
  let counted = new Map<number, Message>()
  /** Replies deleted in live or found gone in `catchUp`: no page or late `created` brings them back. */
  let removed = new Set<number>()
  /** Latest live edit of each message of the thread (root included), so older snapshots do not revert it. */
  let edits = new Map<number, Message>()
  let removal: Removal | null = null
  let rootDeletedAt: string | null = null

  function clear(): void {
    generation++
    controller.abort()
    controller = new AbortController()
    opening = Promise.resolve()
    openFailed = false
    base = null
    counted = new Map()
    removed = new Set()
    edits = new Map()
    removal = null
    rootDeletedAt = null
    channelId.value = null
    rootId.value = null
    threadRoot.value = null
    replies.value = []
    nextCursor.value = null
    loading.value = false
    loadingMore.value = false
    error.value = null
    draft.value = null
  }

  function setDraft(next: MentionDraft | null): void {
    if (rootId.value === null) return
    draft.value = next === null || next.text === '' ? null : { rootId: rootId.value, ...next }
  }

  function refreshRoot(): void {
    if (base === null) return
    let root = base.root
    for (const reply of counted.values()) {
      if (snapshotCounts(base.bound, reply.created_at)) continue
      root = { ...root, replies_count: root.replies_count + 1, last_reply_at: laterDate(root.last_reply_at, reply.created_at) }
    }
    threadRoot.value = rootDeletedAt !== null && root.deleted_at === null ? asDeleted(root, rootDeletedAt) : root
  }

  /** Takes the root of a page loaded since `since`, unless a live deletion applied later makes its counters stale. */
  function applyRoot(incoming: Message | undefined, since: number): void {
    if (incoming === undefined || incoming.id !== rootId.value) return
    const content = keepNewerContent(incoming, base?.root ?? edits.get(incoming.id))
    base =
      removal !== null && removal.seq > since
        ? { root: withCounters(content, removal.counters), bound: laterDate(removal.counters.last_reply_at, removal.deletedAt) }
        : { root: content, bound: content.last_reply_at }
    refreshRoot()
  }

  /** Merges by id: the incoming version wins unless its content predates a live edit; removed replies stay out. */
  function mergeReplies(current: readonly Message[], incoming: readonly Message[]): Message[] {
    const byId = new Map(current.map((reply) => [reply.id, reply]))
    for (const reply of incoming) byId.set(reply.id, keepNewerContent(reply, byId.get(reply.id) ?? edits.get(reply.id)))
    return [...byId.values()].filter((reply) => !removed.has(reply.id)).sort((a, b) => a.id - b.id)
  }

  function forget(id: number): void {
    removed.add(id)
    counted.delete(id)
    edits.delete(id)
  }

  function insert(message: Message): boolean {
    if (rootId.value === null || message.channel_id !== channelId.value || message.parent_id !== rootId.value) return false
    if (removed.has(message.id) || replies.value.some((reply) => reply.id === message.id)) return false
    replies.value = mergeReplies(replies.value, [message])
    counted.set(message.id, message)
    refreshRoot()
    return true
  }

  /** An edit in live of the root or of a reply; ignores older edits and deleted messages. */
  function replace(message: Message): boolean {
    if (rootId.value === null || message.channel_id !== channelId.value) return false
    const isRoot = message.id === rootId.value
    if (!isRoot && (message.parent_id !== rootId.value || removed.has(message.id))) return false
    if (isRoot && rootDeletedAt !== null) return false
    const known = edits.get(message.id)
    if (known !== undefined && isOlderEdit(message, known)) return false
    const current = isRoot ? base?.root : replies.value.find((reply) => reply.id === message.id)
    if (current !== undefined && (current.deleted_at !== null || isOlderEdit(message, current))) return false
    // Edits of replies not loaded yet are kept too: bounded by the events received, and cleared in clear().
    edits.set(message.id, message)
    if (current === undefined) return false
    if (isRoot && base !== null) {
      const root = { ...message, replies_count: current.replies_count, last_reply_at: current.last_reply_at, recent_participants: current.recent_participants }
      base = { ...base, root }
      refreshRoot()
    } else {
      replies.value = replies.value.map((reply) => (reply.id === message.id ? message : reply))
    }
    return true
  }

  /** A deletion in live: drops the reply (or marks the root) and takes the root counters of the event even if they go down. */
  function remove(event: MessageDeletedEvent): boolean {
    if (rootId.value === null || event.channel_id !== channelId.value || event.root.id !== rootId.value) return false
    if (event.parent_id === null && event.id !== rootId.value) return false
    removal = { seq: ++removalSeq, deletedAt: event.deleted_at, counters: event.root }
    if (event.parent_id === null) rootDeletedAt = event.deleted_at
    else {
      forget(event.id)
      replies.value = replies.value.filter((reply) => reply.id !== event.id)
    }
    if (base !== null) {
      base = { root: withCounters(base.root, event.root), bound: laterDate(event.root.last_reply_at, event.deleted_at) }
    }
    refreshRoot()
    return true
  }

  async function load(current: number, channel: number, root: number, since: number): Promise<void> {
    try {
      const page = await listReplies(channel, root, { perPage: MESSAGES_PER_PAGE }, controller.signal)
      if (current !== generation) return
      replies.value = mergeReplies(replies.value, page.data)
      applyRoot(page.meta.root, since)
      nextCursor.value = page.meta.next_cursor
    } catch (caught) {
      if (current !== generation) return
      openFailed = true
      error.value = toApiError(caught)
    } finally {
      if (current === generation) loading.value = false
    }
  }

  function open(channel: number, root: number): Promise<void> {
    const kept = draft.value?.rootId === root ? draft.value : null
    clear()
    draft.value = kept
    channelId.value = channel
    rootId.value = root
    loading.value = true
    opening = load(generation, channel, root, removalSeq)
    return opening
  }

  async function loadOlder(): Promise<void> {
    if (channelId.value === null || rootId.value === null || nextCursor.value === null) return
    if (loading.value || loadingMore.value) return
    const current = generation
    const version = listVersion
    const since = removalSeq
    loadingMore.value = true
    error.value = null
    try {
      const page = await listReplies(
        channelId.value,
        rootId.value,
        { perPage: MESSAGES_PER_PAGE, cursor: nextCursor.value },
        controller.signal,
      )
      if (current !== generation || version !== listVersion) return
      replies.value = mergeReplies(replies.value, page.data)
      applyRoot(page.meta.root, since)
      nextCursor.value = page.meta.next_cursor
    } catch (caught) {
      if (current !== generation || version !== listVersion) return
      error.value = toApiError(caught)
    } finally {
      if (current === generation && version === listVersion) loadingMore.value = false
    }
  }

  /** Fetches the replies missed while disconnected and drops the ones deleted meanwhile; waits for an `open` in flight. */
  async function catchUp(): Promise<void> {
    if (channelId.value === null || rootId.value === null) return
    const current = generation
    await opening
    if (current !== generation || openFailed) return
    const channel = channelId.value as number
    const root = rootId.value as number
    const since = removalSeq
    const lastLoadedId = replies.value.length > 0 ? replies.value[replies.value.length - 1].id : null
    const startIds = new Set(replies.value.map((reply) => reply.id))
    const fetched: Message[] = []
    let newest: RepliesPage | null = null
    let joined = false
    let cursor: string | null = null
    try {
      for (let pages = 0; pages < CATCH_UP_MAX_PAGES && !joined; pages++) {
        const page: RepliesPage = await listReplies(
          channel,
          root,
          { perPage: MESSAGES_PER_PAGE, cursor },
          controller.signal,
        )
        if (current !== generation) return
        newest ??= page
        fetched.push(...page.data)
        cursor = page.meta.next_cursor
        joined = lastLoadedId === null || cursor === null || page.data.some((reply) => reply.id <= lastLoadedId)
      }
    } catch {
      return
    }
    if (newest === null) return
    applyRoot(newest.meta.root, since)
    const covered = joined ? fetched : newest.data
    // The pages cover [lower, upper]: what was loaded at the start inside it and did not come was deleted.
    const coveredIds = new Set(covered.map((reply) => reply.id))
    const upper = Math.max(lastLoadedId ?? -Infinity, ...coveredIds)
    const lower = joined && cursor === null ? -Infinity : Math.min(...coveredIds)
    for (const id of startIds) if (id >= lower && id <= upper && !coveredIds.has(id)) forget(id)
    if (joined) {
      replies.value = mergeReplies(replies.value, fetched)
      return
    }
    const oldestId = Math.min(...newest.data.map((reply) => reply.id))
    replies.value = mergeReplies(
      replies.value.filter((reply) => reply.id > oldestId),
      newest.data,
    )
    nextCursor.value = newest.meta.next_cursor
    listVersion++
    loadingMore.value = false
  }

  /** Sends a reply to the open thread; API errors propagate to the composer. */
  async function send(body: string, attachmentIds: number[] = []): Promise<void> {
    if (channelId.value === null || rootId.value === null) return
    const current = generation
    const reply = await sendReply(channelId.value, rootId.value, body, attachmentIds)
    useMessagesStore().insert(reply)
    if (current !== generation) return
    insert(reply)
  }

  return {
    channelId,
    rootId,
    root: threadRoot,
    replies,
    draft,
    setDraft,
    nextCursor,
    loading,
    loadingMore,
    error,
    open,
    loadOlder,
    insert,
    replace,
    remove,
    catchUp,
    send,
    clear,
  }
})
