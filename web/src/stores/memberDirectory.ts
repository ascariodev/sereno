import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { listMembers } from '../api/members'
import type { Member } from '../api/types'
import { useOrganizationStore } from './organization'

/** Members of the active organization, loaded once for the mention suggestions and dropped on any organization change or logout. */
export const useMemberDirectoryStore = defineStore('memberDirectory', () => {
  const organization = useOrganizationStore()
  const members = ref<Member[]>([])
  const loadedFor = ref<number | null>(null)
  const loading = ref(false)
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

  function ensureLoaded(): Promise<void> {
    const orgId = organization.activeId
    if (orgId === null || loadedFor.value === orgId) return Promise.resolve()
    if (inFlight) return inFlight
    const current = generation
    loading.value = true
    const request = listMembers()
      .then((list) => {
        if (current !== generation) return
        members.value = list
        loadedFor.value = orgId
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

  return { members, loading, ensureLoaded, clear }
})
