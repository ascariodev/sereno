import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { listMembers } from '../api/members'
import type { Member } from '../api/types'
import { useOrganizationStore } from './organization'

/** How long a loaded list is reused before the next open refreshes it. */
export const MEMBER_DIRECTORY_TTL_MS = 5 * 60 * 1000

/**
 * Members of the active organization for the mention suggestions: dropped on any organization change or logout,
 * and refreshed (keeping the old list visible meanwhile) after `invalidate()` or once it is older than the TTL.
 */
export const useMemberDirectoryStore = defineStore('memberDirectory', () => {
  const organization = useOrganizationStore()
  const members = ref<Member[]>([])
  const loadedFor = ref<number | null>(null)
  const loading = ref(false)
  let loadedAt = 0
  let generation = 0
  let inFlight: Promise<void> | null = null

  function clear(): void {
    generation++
    members.value = []
    loadedFor.value = null
    loading.value = false
    inFlight = null
  }

  watch(() => organization.activeId, clear, { flush: 'sync' })

  /** Marks the cached list stale (members changed in the same organization); the next `ensureLoaded` refetches. */
  function invalidate(): void {
    generation++
    loadedFor.value = null
    loading.value = false
    inFlight = null
  }

  function ensureLoaded(): Promise<void> {
    const orgId = organization.activeId
    if (orgId === null) return Promise.resolve()
    if (loadedFor.value === orgId && Date.now() - loadedAt < MEMBER_DIRECTORY_TTL_MS) return Promise.resolve()
    if (inFlight) return inFlight
    const current = generation
    loading.value = true
    const request = listMembers()
      .then((list) => {
        if (current !== generation) return
        members.value = list
        loadedFor.value = orgId
        loadedAt = Date.now()
      })
      .catch(() => {})
      .finally(() => {
        if (current !== generation) return
        loading.value = false
        inFlight = null
      })
    inFlight = request
    return request
  }

  return { members, loading, ensureLoaded, invalidate, clear }
})
