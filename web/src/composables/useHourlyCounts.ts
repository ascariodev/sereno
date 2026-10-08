import { reactive } from 'vue'
import { getHourlyCounts } from '../api/logGroups'

export const HOURLY_BATCH_SIZE = 100

const counts = reactive(new Map<number, number[]>())
const newestNotice = new Map<number, number>()
const requestVersion = new Map<number, number>()
let queued = new Map<number, Set<number>>()
let flushScheduled = false
let generation = 0
let controller = new AbortController()

async function fetchChunk(projectId: number, ids: number[], versions: Map<number, number>): Promise<void> {
  const current = generation
  try {
    const response = await getHourlyCounts(projectId, ids, controller.signal)
    if (current !== generation) return
    const received = response.counts ?? {}
    for (const id of ids) {
      if (requestVersion.get(id) !== versions.get(id)) continue
      const series = received[String(id)]
      if (Array.isArray(series)) counts.set(id, series)
    }
  } catch (error) {
    if (current !== generation || (error instanceof DOMException && error.name === 'AbortError')) return
    for (const id of ids) {
      if (requestVersion.get(id) === versions.get(id)) newestNotice.delete(id)
    }
  }
}

function flush(): void {
  flushScheduled = false
  const batch = queued
  queued = new Map()
  for (const [projectId, groupIds] of batch) {
    const ids = [...groupIds]
    const versions = new Map(ids.map((id) => [id, requestVersion.get(id) ?? 0]))
    for (let start = 0; start < ids.length; start += HOURLY_BATCH_SIZE) {
      void fetchChunk(projectId, ids.slice(start, start + HOURLY_BATCH_SIZE), versions)
    }
  }
}

/**
 * Registers a mounted notice. Notices mounted in the same tick share one request per project;
 * a notice newer than the last one seen for its group refreshes that group's counts.
 */
export function requestHourlyCounts(projectId: number, groupId: number, messageId: number): void {
  const previous = newestNotice.get(groupId)
  if (previous !== undefined && messageId <= previous) return
  newestNotice.set(groupId, messageId)
  requestVersion.set(groupId, (requestVersion.get(groupId) ?? 0) + 1)
  const ids = queued.get(projectId) ?? new Set<number>()
  ids.add(groupId)
  queued.set(projectId, ids)
  if (!flushScheduled) {
    flushScheduled = true
    queueMicrotask(flush)
  }
}

export function hourlyCountsOf(groupId: number | null): number[] | null {
  return groupId === null ? null : (counts.get(groupId) ?? null)
}

export function resetHourlyCounts(): void {
  generation++
  controller.abort()
  controller = new AbortController()
  counts.clear()
  newestNotice.clear()
  requestVersion.clear()
  queued = new Map()
}
