import { ApiError } from '../api/client'
import type { Task } from '../api/types'

/** Where the task lands: right above `beforeId`, right below `afterId`, or at the end of the column (`null`). */
export type MoveAnchor = { beforeId: number } | { afterId: number } | null

export interface MoveNeighbours {
  afterId: number | null
  beforeId: number | null
}

/**
 * Neighbours for the move API in the full target column (never `visibleColumns`: the API needs contiguous neighbours).
 * The moved task is left out, so an anchor next to its own slot gives back its current neighbours.
 */
export function moveNeighbours(column: readonly Task[], taskId: number, anchor: MoveAnchor): MoveNeighbours {
  const list = column.filter((item) => item.id !== taskId)
  if (anchor !== null) {
    const id = 'beforeId' in anchor ? anchor.beforeId : anchor.afterId
    const at = list.findIndex((item) => item.id === id)
    if (at >= 0 && 'beforeId' in anchor) return { afterId: list[at - 1]?.id ?? null, beforeId: id }
    if (at >= 0) return { afterId: id, beforeId: list[at + 1]?.id ?? null }
  }
  return { afterId: list[list.length - 1]?.id ?? null, beforeId: null }
}

export function moveErrorMessage(caught: unknown, t: (key: string) => string): string {
  const error = caught instanceof ApiError ? caught : new ApiError(0, String(caught))
  if (error.status === 403) return t('plan.move.forbidden')
  if (error.status === 404) return t('plan.move.notFound')
  if (error.status === 422) return error.message
  if (error.status === 0) return t('taskCreate.network')
  return t('plan.move.failed')
}
