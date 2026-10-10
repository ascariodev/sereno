import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Task, TaskStatus } from '../api/types'
import { moveErrorMessage, moveNeighbours, type MoveAnchor } from '../components/taskMove'
import { toast } from '../components/ui/toast'
import { useTasksStore } from '../stores/tasks'

/** Drop target in visible terms: above the visible card `beforeId`, or below the last visible card (`null`). */
export interface TaskDropTarget {
  status: TaskStatus
  beforeId: number | null
}

/**
 * HTML5 drag and drop of task cards. Cards carry `data-task-id`; the column is the drop zone.
 * With a filter on, the drop is anchored to the visible neighbour: above a visible card means right above it in the
 * full column, and below the last visible card means right below it (hidden tasks keep their relative order).
 */
export function useTaskDrag(projectId: () => number, canDrag: () => boolean) {
  const { t } = useI18n()
  const tasks = useTasksStore()
  const dragging = ref<number | null>(null)
  const target = ref<TaskDropTarget | null>(null)
  const moving = ref(false)

  function visibleSuccessor(task: Task): number | null {
    const list = tasks.visibleColumns[task.status]
    const at = list.findIndex((item) => item.id === task.id)
    return at >= 0 ? (list[at + 1]?.id ?? null) : null
  }

  /** Whether dropping on `drop` leaves the dragged task where it is. */
  function isSamePlace(task: Task, drop: TaskDropTarget): boolean {
    return task.status === drop.status && visibleSuccessor(task) === drop.beforeId
  }

  function draggedTask(): Task | undefined {
    return dragging.value === null ? undefined : tasks.find(dragging.value)
  }

  function showsLine(status: TaskStatus, beforeId: number | null): boolean {
    const drop = target.value
    const task = draggedTask()
    return drop !== null && task !== undefined && drop.status === status && drop.beforeId === beforeId && !isSamePlace(task, drop)
  }

  function start(task: Task, event: DragEvent): void {
    if (!canDrag() || moving.value) {
      event.preventDefault()
      return
    }
    dragging.value = task.id
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', task.key)
    }
  }

  function end(): void {
    dragging.value = null
    target.value = null
  }

  function over(status: TaskStatus, event: DragEvent): void {
    if (dragging.value === null || !canDrag()) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    const zone = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    const cards = zone ? [...zone.querySelectorAll<HTMLElement>('[data-task-id]')] : []
    let beforeId: number | null = null
    for (const card of cards) {
      const id = Number(card.dataset.taskId)
      if (id === dragging.value) continue
      const rect = card.getBoundingClientRect()
      if (event.clientY < rect.top + rect.height / 2) {
        beforeId = id
        break
      }
    }
    if (target.value?.status !== status || target.value.beforeId !== beforeId) target.value = { status, beforeId }
  }

  function leave(status: TaskStatus, event: DragEvent): void {
    const zone = event.currentTarget
    const next = event.relatedTarget
    if (zone instanceof Node && next instanceof Node && zone.contains(next)) return
    if (target.value?.status === status) target.value = null
  }

  async function drop(status: TaskStatus, event: DragEvent): Promise<void> {
    event.preventDefault()
    const drop = target.value?.status === status ? target.value : null
    const task = draggedTask()
    end()
    if (!drop || !task || moving.value || !canDrag() || isSamePlace(task, drop)) return
    let anchor: MoveAnchor
    if (drop.beforeId !== null) anchor = { beforeId: drop.beforeId }
    else {
      const visible = tasks.visibleColumns[status].filter((item) => item.id !== task.id)
      const last = visible[visible.length - 1]
      anchor = last ? { afterId: last.id } : null
    }
    moving.value = true
    try {
      await tasks.move(projectId(), task.id, { status, ...moveNeighbours(tasks.columns[status], task.id, anchor) })
    } catch (caught) {
      toast.error(moveErrorMessage(caught, t))
    } finally {
      moving.value = false
    }
  }

  return { dragging, target, moving, showsLine, start, end, over, leave, drop }
}
