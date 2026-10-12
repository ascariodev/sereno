import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { ApiError } from '../api/client'
import { createTaskComment, listTaskComments } from '../api/taskComments'
import type { TaskComment } from '../api/types'

export const COMMENTS_PER_PAGE = 30

function toApiError(caught: unknown): ApiError {
  return caught instanceof ApiError ? caught : new ApiError(0, String(caught))
}

/** Merges by id (the incoming version wins) in display order: oldest first. */
function mergeComments(current: readonly TaskComment[], incoming: readonly TaskComment[]): TaskComment[] {
  const byId = new Map(current.map((comment) => [comment.id, comment]))
  for (const comment of incoming) byId.set(comment.id, comment)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

export const useTaskCommentsStore = defineStore('taskComments', () => {
  const projectId = ref<number | null>(null)
  const taskId = ref<number | null>(null)
  /** Oldest first. */
  const comments = shallowRef<TaskComment[]>([])
  /** Cursor towards older comments; null when there are none left. */
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<ApiError | null>(null)
  let generation = 0
  /** Bumped when the list is replaced, so a page of older comments requested before it is dropped (L-14). */
  let listVersion = 0
  let controller = new AbortController()
  let opening: Promise<void> = Promise.resolve()
  let openFailed = false

  function clear(): void {
    generation++
    listVersion++
    controller.abort()
    controller = new AbortController()
    opening = Promise.resolve()
    openFailed = false
    projectId.value = null
    taskId.value = null
    comments.value = []
    nextCursor.value = null
    loading.value = false
    loadingMore.value = false
    error.value = null
  }

  async function load(current: number, project: number, task: number): Promise<void> {
    try {
      const page = await listTaskComments(project, task, { perPage: COMMENTS_PER_PAGE }, controller.signal)
      if (current !== generation) return
      comments.value = mergeComments(comments.value, page.data)
      nextCursor.value = page.meta.next_cursor
    } catch (caught) {
      if (current !== generation) return
      openFailed = true
      error.value = toApiError(caught)
    } finally {
      if (current === generation) loading.value = false
    }
  }

  function open(project: number, task: number): Promise<void> {
    clear()
    projectId.value = project
    taskId.value = task
    loading.value = true
    opening = load(generation, project, task)
    return opening
  }

  async function loadOlder(): Promise<void> {
    if (projectId.value === null || taskId.value === null || nextCursor.value === null) return
    if (loading.value || loadingMore.value) return
    const current = generation
    const version = listVersion
    loadingMore.value = true
    error.value = null
    try {
      const page = await listTaskComments(
        projectId.value,
        taskId.value,
        { perPage: COMMENTS_PER_PAGE, cursor: nextCursor.value },
        controller.signal,
      )
      if (current !== generation || version !== listVersion) return
      comments.value = mergeComments(comments.value, page.data)
      nextCursor.value = page.meta.next_cursor
    } catch (caught) {
      if (current !== generation || version !== listVersion) return
      error.value = toApiError(caught)
    } finally {
      if (current === generation && version === listVersion) loadingMore.value = false
    }
  }

  /** Fetches the newest comments after a reconnection; if they do not reach the loaded ones the list is replaced. */
  async function refresh(): Promise<void> {
    if (projectId.value === null || taskId.value === null) return
    const current = generation
    await opening
    if (current !== generation || openFailed) return
    const project = projectId.value as number
    const task = taskId.value as number
    const newestLoaded = comments.value.length > 0 ? comments.value[comments.value.length - 1].id : null
    let page
    try {
      page = await listTaskComments(project, task, { perPage: COMMENTS_PER_PAGE }, controller.signal)
    } catch {
      return
    }
    if (current !== generation) return
    const joined = newestLoaded === null || page.meta.next_cursor === null || page.data.some((comment) => comment.id <= newestLoaded)
    if (joined) {
      comments.value = mergeComments(comments.value, page.data)
      if (newestLoaded === null) nextCursor.value = page.meta.next_cursor
      return
    }
    const newestInPage = Math.max(...page.data.map((comment) => comment.id))
    comments.value = mergeComments(
      comments.value.filter((comment) => comment.id > newestInPage),
      page.data,
    )
    nextCursor.value = page.meta.next_cursor
    listVersion++
    loadingMore.value = false
  }

  /** A comment received in live: only for the open task, and not twice if the POST response already brought it. */
  function insert(comment: TaskComment): boolean {
    if (taskId.value === null || comment.task_id !== taskId.value) return false
    if (comments.value.some((known) => known.id === comment.id)) return false
    comments.value = mergeComments(comments.value, [comment])
    return true
  }

  /** An edited comment: replaces the known one of the open task, unless the known one has a newer edit. */
  function update(comment: TaskComment): boolean {
    if (taskId.value === null || comment.task_id !== taskId.value) return false
    const known = comments.value.find((item) => item.id === comment.id)
    if (known === undefined) return false
    if (known.edited_at != null && (comment.edited_at == null || Date.parse(comment.edited_at) < Date.parse(known.edited_at))) {
      return false
    }
    comments.value = mergeComments(comments.value, [comment])
    return true
  }

  function remove(id: number): boolean {
    if (!comments.value.some((item) => item.id === id)) return false
    comments.value = comments.value.filter((item) => item.id !== id)
    return true
  }

  /** Posts a comment on the open task; API errors propagate to the composer. */
  async function send(body: string, attachmentIds: number[] = []): Promise<number | null> {
    if (projectId.value === null || taskId.value === null) return null
    const current = generation
    const comment = await createTaskComment(projectId.value, taskId.value, body, attachmentIds)
    if (current !== generation) return null
    insert(comment)
    return comment.id
  }

  return { projectId, taskId, comments, nextCursor, loading, loadingMore, error, open, loadOlder, refresh, insert, update, remove, send, clear }
})
