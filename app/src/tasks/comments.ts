import { create } from 'zustand'

import { api } from '@/api/client'
import type { MessageAttachment } from '@/messages/store'

export const COMMENTS_PER_PAGE = 30
export const COMMENT_MAX_LENGTH = 10000

export interface TaskComment {
  id: number
  task_id: number
  body: string
  user: { id: number; name: string } | null
  mentions: { id: number; name: string }[]
  attachments: MessageAttachment[]
  created_at: string
  edited_at: string | null
}

interface CommentsPage {
  data: TaskComment[]
  meta: { next_cursor: string | null }
}

const base = (projectId: number, taskId: number) => `/api/projects/${projectId}/tasks/${taskId}/comments`

// Display order: oldest first. The incoming version wins.
function mergeComments(current: readonly TaskComment[], incoming: readonly TaskComment[]): TaskComment[] {
  const byId = new Map(current.map((comment) => [comment.id, comment]))
  for (const comment of incoming) byId.set(comment.id, comment)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

interface TaskCommentsState {
  projectId: number | null
  taskId: number | null
  comments: TaskComment[]
  nextCursor: string | null
  loading: boolean
  loadingMore: boolean
  failed: boolean
  open(projectId: number, taskId: number): Promise<void>
  loadOlder(): Promise<void>
  send(body: string): Promise<number | null>
  update(projectId: number, taskId: number, commentId: number, body: string): Promise<TaskComment>
  destroy(projectId: number, taskId: number, commentId: number): Promise<void>
  insert(comment: TaskComment): boolean
  replace(comment: TaskComment): boolean
  remove(id: number): boolean
  clear(): void
}

let generation = 0
// Bumped when the list is replaced, so a page of older comments requested before it is dropped.
let listVersion = 0

export const useTaskCommentsStore = create<TaskCommentsState>()((set, get) => ({
  projectId: null,
  taskId: null,
  comments: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  failed: false,

  async open(projectId, taskId) {
    get().clear()
    const current = generation
    set({ projectId, taskId, loading: true })
    try {
      const page = await api.get<CommentsPage>(base(projectId, taskId), {
        query: { per_page: COMMENTS_PER_PAGE },
      })
      if (current !== generation) return
      set((state) => ({
        comments: mergeComments(state.comments, page.data),
        nextCursor: page.meta.next_cursor,
      }))
    } catch {
      if (current !== generation) return
      set({ failed: true })
    } finally {
      if (current === generation) set({ loading: false })
    }
  },

  async loadOlder() {
    const { projectId, taskId, nextCursor, loading, loadingMore } = get()
    if (projectId === null || taskId === null || nextCursor === null || loading || loadingMore) return
    const current = generation
    const version = listVersion
    set({ loadingMore: true, failed: false })
    try {
      const page = await api.get<CommentsPage>(base(projectId, taskId), {
        query: { per_page: COMMENTS_PER_PAGE, cursor: nextCursor },
      })
      if (current !== generation || version !== listVersion) return
      set((state) => ({
        comments: mergeComments(state.comments, page.data),
        nextCursor: page.meta.next_cursor,
      }))
    } catch {
      if (current !== generation || version !== listVersion) return
      // Keeps what is shown (L-89): the cursor stays, so the retry asks for the page that failed.
      set({ failed: true })
    } finally {
      if (current === generation && version === listVersion) set({ loadingMore: false })
    }
  },

  async send(body) {
    const { projectId, taskId } = get()
    if (projectId === null || taskId === null) return null
    const current = generation
    const response = await api.post<{ data: TaskComment }>(base(projectId, taskId), { body })
    if (current !== generation) return null
    get().insert(response.data)
    return response.data.id
  },

  async update(projectId, taskId, commentId, body) {
    const response = await api.patch<{ data: TaskComment }>(`${base(projectId, taskId)}/${commentId}`, { body })
    if (get().taskId === taskId) get().replace(response.data)
    return response.data
  },

  async destroy(projectId, taskId, commentId) {
    await api.delete(`${base(projectId, taskId)}/${commentId}`)
    if (get().taskId === taskId) get().remove(commentId)
  },

  insert(comment) {
    const { taskId, comments } = get()
    if (taskId === null || comment.task_id !== taskId) return false
    if (comments.some((known) => known.id === comment.id)) return false
    set({ comments: mergeComments(comments, [comment]) })
    return true
  },

  replace(comment) {
    const { taskId, comments } = get()
    if (taskId === null || comment.task_id !== taskId) return false
    const known = comments.find((item) => item.id === comment.id)
    if (known === undefined) return false
    if (
      known.edited_at != null &&
      (comment.edited_at == null || Date.parse(comment.edited_at) < Date.parse(known.edited_at))
    ) {
      return false
    }
    set({ comments: mergeComments(comments, [comment]) })
    return true
  },

  remove(id) {
    const { comments } = get()
    if (!comments.some((item) => item.id === id)) return false
    set({ comments: comments.filter((item) => item.id !== id) })
    return true
  },

  clear() {
    generation++
    listVersion++
    set({
      projectId: null,
      taskId: null,
      comments: [],
      nextCursor: null,
      loading: false,
      loadingMore: false,
      failed: false,
    })
  },
}))
