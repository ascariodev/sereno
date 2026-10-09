import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { ApiError } from '../api/client'
import { listReplies, sendReply } from '../api/messages'
import type { Message, RepliesPage } from '../api/types'
import { CATCH_UP_MAX_PAGES, MESSAGES_PER_PAGE, useMessagesStore } from './messages'

function toApiError(caught: unknown): ApiError {
  return caught instanceof ApiError ? caught : new ApiError(0, String(caught))
}

/** Adds the replies not yet present, keeping the list sorted by id (oldest first). */
function withReplies(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const known = new Set(current.map((reply) => reply.id))
  const added = incoming.filter((reply) => !known.has(reply.id))
  if (added.length === 0) return current as Message[]
  return [...current, ...added].sort((a, b) => a.id - b.id)
}

/** Takes the root from a page without lowering the counters already bumped by live replies. */
function withRoot(current: Message | null, incoming: Message | undefined): Message | null {
  if (!incoming) return current
  if (current === null || current.id !== incoming.id) return incoming
  const last = [current.last_reply_at, incoming.last_reply_at].filter((at): at is string => at !== null).sort().pop() ?? null
  return { ...incoming, replies_count: Math.max(current.replies_count, incoming.replies_count), last_reply_at: last }
}

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
  let generation = 0
  let listVersion = 0
  let controller = new AbortController()
  let opening: Promise<void> = Promise.resolve()
  let openFailed = false

  function clear(): void {
    generation++
    controller.abort()
    controller = new AbortController()
    opening = Promise.resolve()
    openFailed = false
    channelId.value = null
    rootId.value = null
    threadRoot.value = null
    replies.value = []
    nextCursor.value = null
    loading.value = false
    loadingMore.value = false
    error.value = null
  }

  function insert(message: Message): boolean {
    if (rootId.value === null || message.channel_id !== channelId.value || message.parent_id !== rootId.value) return false
    const next = withReplies(replies.value, [message])
    if (next === replies.value) return false
    replies.value = next
    if (threadRoot.value !== null) {
      const at = threadRoot.value.last_reply_at
      threadRoot.value = {
        ...threadRoot.value,
        replies_count: threadRoot.value.replies_count + 1,
        last_reply_at: at !== null && at > message.created_at ? at : message.created_at,
      }
    }
    return true
  }

  async function load(current: number, channel: number, root: number): Promise<void> {
    try {
      const page = await listReplies(channel, root, { perPage: MESSAGES_PER_PAGE }, controller.signal)
      if (current !== generation) return
      replies.value = withReplies(page.data.slice().sort((a, b) => a.id - b.id), replies.value)
      threadRoot.value = withRoot(threadRoot.value, page.meta.root)
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
    clear()
    channelId.value = channel
    rootId.value = root
    loading.value = true
    opening = load(generation, channel, root)
    return opening
  }

  async function loadOlder(): Promise<void> {
    if (channelId.value === null || rootId.value === null || nextCursor.value === null) return
    if (loading.value || loadingMore.value) return
    const current = generation
    const version = listVersion
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
      replies.value = withReplies(replies.value, page.data)
      threadRoot.value = withRoot(threadRoot.value, page.meta.root)
      nextCursor.value = page.meta.next_cursor
    } catch (caught) {
      if (current !== generation || version !== listVersion) return
      error.value = toApiError(caught)
    } finally {
      if (current === generation && version === listVersion) loadingMore.value = false
    }
  }

  /** Fetches the replies missed while disconnected; waits for an `open` still in flight first. */
  async function catchUp(): Promise<void> {
    if (channelId.value === null || rootId.value === null) return
    const current = generation
    await opening
    if (current !== generation || openFailed) return
    const channel = channelId.value as number
    const root = rootId.value as number
    const lastLoadedId = replies.value.length > 0 ? replies.value[replies.value.length - 1].id : null
    const fetched: Message[] = []
    let newest: RepliesPage | null = null
    let joined = false
    try {
      let cursor: string | null = null
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
    threadRoot.value = withRoot(threadRoot.value, newest?.meta.root)
    if (joined || newest === null) {
      replies.value = withReplies(replies.value, fetched)
      return
    }
    const oldestId = Math.min(...newest.data.map((reply) => reply.id))
    const live = replies.value.filter((reply) => reply.id > oldestId)
    replies.value = withReplies(newest.data.slice().sort((a, b) => a.id - b.id), live)
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

  return { channelId, rootId, root: threadRoot, replies, nextCursor, loading, loadingMore, error, open, loadOlder, insert, catchUp, send, clear }
})
