import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { ApiError } from '../api/client'
import {
  createTask,
  deleteTask,
  listTasks,
  moveTask,
  updateTask,
  type CreateTaskInput,
  type MoveTaskInput,
  type UpdateTaskInput,
} from '../api/tasks'
import { isTaskStatus, TASK_STATUSES, type Task, type TaskDeletedEvent, type TaskStatus } from '../api/types'
import { useAuthStore } from './auth'

export const TASK_FILTERS = ['all', 'mine', 'from_notices'] as const
export type TaskFilter = (typeof TASK_FILTERS)[number]

/** Deleted ids remembered so a late event or response does not bring them back (oldest dropped first). */
export const MAX_TOMBSTONES = 500

export type TaskColumns = Record<TaskStatus, Task[]>

function toApiError(caught: unknown): ApiError {
  return caught instanceof ApiError ? caught : new ApiError(0, String(caught))
}

/**
 * `updated_at` in microseconds: the API sends six fractional digits and `Date.parse` keeps only three.
 * An unparsable date gives NaN, which compares false both ways, so `isStale` lets the incoming version win.
 */
export function updatedStamp(iso: string): number {
  const fraction = /\.(\d+)/.exec(iso)?.[1] ?? ''
  const millis = Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'))
  return millis * 1000 + Number(fraction.slice(3, 6).padEnd(3, '0'))
}

/**
 * Whether `incoming` is an older version than `current`. On a tie the incoming one wins: a move response and its
 * `task.updated` carry the same version, and a column renumbering changes positions without touching `updated_at`.
 */
export function isStale(incoming: Task, current: Task): boolean {
  return updatedStamp(incoming.updated_at) < updatedStamp(current.updated_at)
}

/** Column order of the API: `position`, then `id`. */
export function compareTasks(a: Task, b: Task): number {
  return a.position - b.position || a.id - b.id
}

export function matchesFilter(task: Task, filter: TaskFilter, userId: number | null): boolean {
  if (filter === 'mine') return userId !== null && task.assignee?.id === userId
  if (filter === 'from_notices') return task.log_group != null
  return true
}

function toColumns(list: readonly Task[]): TaskColumns {
  const columns = Object.fromEntries(TASK_STATUSES.map((status) => [status, [] as Task[]])) as TaskColumns
  for (const task of list) columns[task.status].push(task)
  for (const status of TASK_STATUSES) columns[status].sort(compareTasks)
  return columns
}

export const useTasksStore = defineStore('tasks', () => {
  const auth = useAuthStore()
  const projectId = ref<number | null>(null)
  /** Unordered; `columns` gives the board order. */
  const tasks = shallowRef<Task[]>([])
  const loading = ref(false)
  const error = ref<ApiError | null>(null)
  /** A view preference: kept across projects and `clear()`. */
  const filter = ref<TaskFilter>('all')
  let generation = 0
  let loadSeq = 0
  let controller = new AbortController()
  let tombstones = new Set<number>()
  let latestLoad: Promise<boolean> = Promise.resolve(false)
  /** Whether a load of the open project ever succeeded: until then a failed load (open or refresh) sets `error`. */
  let everLoaded = false

  const columns = computed(() => toColumns(tasks.value))
  const visibleColumns = computed(() => {
    const userId = auth.user?.id ?? null
    const current = filter.value
    if (current === 'all') return columns.value
    return toColumns(tasks.value.filter((task) => matchesFilter(task, current, userId)))
  })

  function find(id: number): Task | undefined {
    return tasks.value.find((task) => task.id === id)
  }

  function accepts(task: Task): boolean {
    return projectId.value !== null && task.project_id === projectId.value && isTaskStatus(task.status) && !tombstones.has(task.id)
  }

  /** Adds or replaces a task of the open project unless it is deleted or older than the loaded version. */
  function upsert(task: Task): boolean {
    if (!accepts(task)) return false
    const index = tasks.value.findIndex((item) => item.id === task.id)
    if (index >= 0 && isStale(task, tasks.value[index])) return false
    const next = tasks.value.slice()
    if (index >= 0) next[index] = task
    else next.push(task)
    tasks.value = next
    return true
  }

  // `insert` and `replace` stay separate so the live subscription maps each event to its own action and their
  // semantics can diverge later without touching callers.

  /** `task.created` in live. Idempotent with the own create response. */
  function insert(task: Task): boolean {
    return upsert(task)
  }

  /** `task.updated` in live (edits and moves). Adds the task if it is not loaded (its `created` was missed). */
  function replace(task: Task): boolean {
    return upsert(task)
  }

  /** `task.deleted` in live. The id is remembered so a late create or update does not bring it back. */
  function remove(event: TaskDeletedEvent): boolean {
    if (projectId.value === null || event.project_id !== projectId.value) return false
    tombstones.add(event.id)
    if (tombstones.size > MAX_TOMBSTONES) tombstones.delete(tombstones.values().next().value as number)
    const next = tasks.value.filter((task) => task.id !== event.id)
    if (next.length === tasks.value.length) return false
    tasks.value = next
    return true
  }

  function clear(): void {
    generation++
    loadSeq++
    controller.abort()
    controller = new AbortController()
    tombstones = new Set()
    everLoaded = false
    projectId.value = null
    tasks.value = []
    loading.value = false
    error.value = null
  }

  /**
   * Takes the server list, keeping live versions newer than it, and the tasks that arrived while it loaded.
   * Tasks loaded before it started and missing from it were deleted.
   */
  async function fetchAll(): Promise<boolean> {
    const current = generation
    const seq = ++loadSeq
    const id = projectId.value as number
    const knownAtStart = new Set(tasks.value.map((task) => task.id))
    try {
      const list = await listTasks(id, controller.signal)
      if (current !== generation) return false
      if (seq !== loadSeq) return latestLoad
      const byId = new Map(tasks.value.map((task) => [task.id, task]))
      const fetched = new Set<number>()
      const merged: Task[] = []
      for (const task of list) {
        if (!accepts(task) || fetched.has(task.id)) continue
        fetched.add(task.id)
        const live = byId.get(task.id)
        merged.push(live !== undefined && isStale(task, live) ? live : task)
      }
      for (const task of tasks.value) {
        if (!fetched.has(task.id) && !knownAtStart.has(task.id)) merged.push(task)
      }
      tasks.value = merged
      everLoaded = true
      error.value = null
      return true
    } catch (caught) {
      if (current !== generation) return false
      if (seq !== loadSeq) return latestLoad
      if (!everLoaded) error.value = toApiError(caught)
      return false
    } finally {
      if (current === generation && seq === loadSeq) loading.value = false
    }
  }

  function startLoad(): Promise<boolean> {
    latestLoad = fetchAll()
    return latestLoad
  }

  /**
   * Loads the board of a project from scratch. Opening the project already open only reloads it, so the own
   * actions in flight still apply their response.
   */
  function open(id: number): Promise<boolean> {
    if (projectId.value === id) {
      if (!everLoaded) {
        loading.value = true
        error.value = null
      }
      return startLoad()
    }
    clear()
    projectId.value = id
    loading.value = true
    return startLoad()
  }

  /**
   * Reloads the open project keeping the list (reconnection). A failure keeps the list and sets `error` only if
   * no load of the project succeeded yet.
   * False if it failed or `clear()` discarded it; replaced by a newer load, it waits for that one (L-35).
   */
  function refresh(): Promise<boolean> {
    if (projectId.value === null) return Promise.resolve(false)
    return startLoad()
  }

  /** Applies an own response unless the store was cleared or switched project meanwhile. */
  function applyOwn(current: number, project: number, task: Task): void {
    if (current === generation && project === projectId.value) upsert(task)
  }

  /** The actions throw the `ApiError`; they return the server task even when the board no longer shows it. */
  async function create(project: number, input: CreateTaskInput): Promise<Task> {
    const current = generation
    const task = await createTask(project, input)
    applyOwn(current, project, task)
    return task
  }

  async function update(project: number, taskId: number, input: UpdateTaskInput): Promise<Task> {
    const current = generation
    const task = await updateTask(project, taskId, input)
    applyOwn(current, project, task)
    return task
  }

  async function move(project: number, taskId: number, input: MoveTaskInput): Promise<Task> {
    const current = generation
    const task = await moveTask(project, taskId, input)
    applyOwn(current, project, task)
    return task
  }

  async function destroy(project: number, taskId: number): Promise<void> {
    const current = generation
    await deleteTask(project, taskId)
    if (current === generation) remove({ id: taskId, project_id: project })
  }

  return {
    projectId,
    tasks,
    loading,
    error,
    filter,
    columns,
    visibleColumns,
    find,
    open,
    refresh,
    clear,
    insert,
    replace,
    remove,
    create,
    update,
    move,
    destroy,
  }
})
