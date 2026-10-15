import { create } from 'zustand'

import { api } from '@/api/client'
import { forgetGroupTask } from '@/messages/logGroups'

export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_FILTERS = ['all', 'mine', 'from_notices'] as const
export type TaskFilter = (typeof TASK_FILTERS)[number]

export const DONE_PAGE_SIZE = 50

export interface Task {
  id: number
  project_id: number
  key: string
  title: string
  description: string | null
  status: TaskStatus
  position: number
  assignee?: { id: number; name: string } | null
  log_group?: { id: number; title: string } | null
  comments_count?: number
  updated_at: string
}

export type TaskColumns = Record<TaskStatus, Task[]>

interface TaskListResponse {
  data: Task[]
  meta?: { done_total?: number; has_more_done?: boolean }
}

export interface CreateTaskInput {
  title: string
  description?: string | null
  status?: TaskStatus
  assigneeId?: number | null
}

export interface UpdateTaskInput {
  title?: string
  description?: string | null
  assigneeId?: number | null
}

export function updatedStamp(iso: string): number {
  const fraction = /\.(\d+)/.exec(iso)?.[1] ?? ''
  const millis = Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'))
  return millis * 1000 + Number(fraction.slice(3, 6).padEnd(3, '0'))
}

export function isStale(incoming: Task, current: Task): boolean {
  return updatedStamp(incoming.updated_at) < updatedStamp(current.updated_at)
}

interface TasksState {
  projectId: number | null
  tasks: Task[]
  loading: boolean
  failed: boolean
  hasMoreDone: boolean
  doneTotal: number | null
  loadingMoreDone: boolean
  filter: TaskFilter
  open(projectId: number): Promise<void>
  showMoreDone(): Promise<void>
  setFilter(filter: TaskFilter): void
  create(projectId: number, input: CreateTaskInput): Promise<Task>
  update(projectId: number, taskId: number, input: UpdateTaskInput): Promise<Task>
  ensure(projectId: number, taskId: number): Promise<Task | null>
  remove(projectId: number, taskId: number): void
  clear(): void
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)
}

export function compareTasks(a: Task, b: Task): number {
  return a.position - b.position || a.id - b.id
}

export function matchesFilter(task: Task, filter: TaskFilter, userId: number | null): boolean {
  if (filter === 'mine') return userId !== null && task.assignee?.id === userId
  if (filter === 'from_notices') return task.log_group != null
  return true
}

export function toColumns(list: readonly Task[], filter: TaskFilter = 'all', userId: number | null = null): TaskColumns {
  const columns = Object.fromEntries(TASK_STATUSES.map((status) => [status, [] as Task[]])) as TaskColumns
  for (const task of list) {
    if (isTaskStatus(task.status) && matchesFilter(task, filter, userId)) columns[task.status].push(task)
  }
  for (const status of TASK_STATUSES) columns[status].sort(compareTasks)
  return columns
}

let generation = 0
let doneLimit = DONE_PAGE_SIZE
let loadSeq = 0
let everLoaded = false
let latestLoad: Promise<boolean> = Promise.resolve(false)

export const useTasksStore = create<TasksState>()((set, get) => {
  function fetchAll(projectId: number, current: number): Promise<boolean> {
    latestLoad = runFetch(projectId, current, ++loadSeq)
    return latestLoad
  }

  async function runFetch(projectId: number, current: number, seq: number): Promise<boolean> {
    try {
      const response = await api.get<TaskListResponse>(`/api/projects/${projectId}/tasks`, {
        query: { done_limit: doneLimit },
      })
      if (current !== generation) return false
      if (seq !== loadSeq) return latestLoad
      const seen = new Set<number>()
      const tasks = response.data.filter(
        (task) => task.project_id === projectId && isTaskStatus(task.status) && !seen.has(task.id) && seen.add(task.id),
      )
      set({
        tasks,
        hasMoreDone: response.meta?.has_more_done === true,
        doneTotal: response.meta?.done_total ?? null,
        failed: false,
      })
      everLoaded = true
      return true
    } catch {
      if (current !== generation) return false
      if (seq !== loadSeq) return latestLoad
      if (!everLoaded) set({ failed: true })
      return false
    }
  }

  function upsert(task: Task, force = false): void {
    const { projectId, tasks, hasMoreDone } = get()
    if (projectId === null || task.project_id !== projectId || !isTaskStatus(task.status)) return
    const index = tasks.findIndex((item) => item.id === task.id)
    if (index >= 0 && isStale(task, tasks[index])) return
    if (index < 0 && !force && hasMoreDone && task.status === 'done') {
      const first = tasks.filter((item) => item.status === 'done').sort(compareTasks)[0]
      if (first !== undefined && compareTasks(task, first) < 0) return
    }
    const next = tasks.slice()
    if (index >= 0) next[index] = task
    else next.push(task)
    set({ tasks: next })
  }

  function applyOwn(current: number, projectId: number, task: Task): void {
    if (current === generation && get().projectId === projectId) upsert(task)
  }

  return {
    projectId: null,
    tasks: [],
    loading: false,
    failed: false,
    hasMoreDone: false,
    doneTotal: null,
    loadingMoreDone: false,
    filter: 'all',
    async open(projectId) {
      generation++
      loadSeq++
      everLoaded = false
      doneLimit = DONE_PAGE_SIZE
      const current = generation
      set({ projectId, tasks: [], loading: true, failed: false, hasMoreDone: false, doneTotal: null, loadingMoreDone: false })
      await fetchAll(projectId, current)
      if (current === generation) set({ loading: false })
    },
    async showMoreDone() {
      const { projectId, hasMoreDone, loadingMoreDone } = get()
      if (projectId === null || !hasMoreDone || loadingMoreDone) return
      const current = generation
      const previous = doneLimit
      doneLimit += DONE_PAGE_SIZE
      set({ loadingMoreDone: true })
      const ok = await fetchAll(projectId, current)
      if (current !== generation) return
      if (!ok) doneLimit = previous
      set({ loadingMoreDone: false })
    },
    setFilter(filter) {
      set({ filter })
    },
    async create(projectId, input) {
      const current = generation
      const body: Record<string, unknown> = { title: input.title }
      if (input.description !== undefined) body.description = input.description
      if (input.status !== undefined) body.status = input.status
      if (input.assigneeId !== undefined) body.assignee_id = input.assigneeId
      const response = await api.post<{ data: Task }>(`/api/projects/${projectId}/tasks`, body)
      applyOwn(current, projectId, response.data)
      return response.data
    },
    async update(projectId, taskId, input) {
      const current = generation
      const body: Record<string, unknown> = {}
      if (input.title !== undefined) body.title = input.title
      if (input.description !== undefined) body.description = input.description
      if (input.assigneeId !== undefined) body.assignee_id = input.assigneeId
      const response = await api.patch<{ data: Task }>(`/api/projects/${projectId}/tasks/${taskId}`, body)
      applyOwn(current, projectId, response.data)
      return response.data
    },
    async ensure(projectId, taskId) {
      const known = get().tasks.find((task) => task.id === taskId)
      if (known) return known
      if (get().projectId !== projectId) return null
      const current = generation
      try {
        const response = await api.get<{ data: Task }>(`/api/projects/${projectId}/tasks/${taskId}`)
        if (current !== generation || get().projectId !== projectId) return null
        upsert(response.data, true)
        return get().tasks.find((task) => task.id === taskId) ?? null
      } catch {
        return null
      }
    },
    remove(projectId, taskId) {
      if (get().projectId !== projectId) return
      forgetGroupTask(taskId)
      set((state) => ({ tasks: state.tasks.filter((task) => task.id !== taskId) }))
    },
    clear() {
      generation++
      loadSeq++
      everLoaded = false
      doneLimit = DONE_PAGE_SIZE
      set({
        projectId: null,
        tasks: [],
        loading: false,
        failed: false,
        hasMoreDone: false,
        doneTotal: null,
        loadingMoreDone: false,
      })
    },
  }
})
