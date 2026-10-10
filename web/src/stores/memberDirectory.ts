import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { listProjectMembers } from '../api/projects'
import type { Member } from '../api/types'
import { useOrganizationStore } from './organization'

/** How long a loaded list is reused before the next open refreshes it. */
export const MEMBER_DIRECTORY_TTL_MS = 5 * 60 * 1000

interface Entry {
  members: Member[]
  loaded: boolean
  loadedAt: number
  generation: number
  inFlight: Promise<void> | null
}

/**
 * Who can see each project (owners, admins and assigned members), for the mention suggestions and the assignee
 * selectors. Everything is dropped on any organization change or logout; one project's list is refreshed (keeping
 * the old one visible meanwhile) after `invalidate(projectId)` or once it is older than the TTL.
 */
export const useMemberDirectoryStore = defineStore('memberDirectory', () => {
  const organization = useOrganizationStore()
  const entries = ref<Record<number, Entry>>({})
  let epoch = 0

  function clear(): void {
    epoch++
    entries.value = {}
  }

  watch(() => organization.activeId, clear, { flush: 'sync' })

  function membersOf(projectId: number | null | undefined): Member[] {
    return projectId == null ? [] : (entries.value[projectId]?.members ?? [])
  }

  /** Marks a project's cached list stale (all of them without an id); the next `ensureLoaded` refetches. */
  function invalidate(projectId?: number): void {
    const targets = projectId === undefined ? Object.values(entries.value) : [entries.value[projectId]]
    for (const entry of targets) {
      if (!entry) continue
      entry.generation++
      entry.loaded = false
      entry.inFlight = null
    }
  }

  function ensureLoaded(projectId: number | null | undefined): Promise<void> {
    const orgId = organization.activeId
    if (orgId === null || projectId == null) return Promise.resolve()
    const existing = entries.value[projectId]
    if (existing?.loaded && Date.now() - existing.loadedAt < MEMBER_DIRECTORY_TTL_MS) return Promise.resolve()
    if (existing?.inFlight) return existing.inFlight
    if (!existing) entries.value[projectId] = { members: [], loaded: false, loadedAt: 0, generation: 0, inFlight: null }
    const entry = entries.value[projectId]
    const currentEpoch = epoch
    const currentGeneration = entry.generation
    const stale = () => currentEpoch !== epoch || currentGeneration !== entry.generation
    const request = listProjectMembers(projectId)
      .then((list) => {
        if (stale()) return
        entry.members = list
        entry.loaded = true
        entry.loadedAt = Date.now()
      })
      .catch(() => {})
      .finally(() => {
        if (!stale()) entry.inFlight = null
      })
    entry.inFlight = request
    return request
  }

  return { entries, membersOf, ensureLoaded, invalidate, clear }
})
