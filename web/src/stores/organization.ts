import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../api/client'
import type { Organization } from '../api/types'

export const ORGANIZATION_STORAGE_KEY = 'workspace.organization'

function readStoredId(): number | null {
  const raw = localStorage.getItem(ORGANIZATION_STORAGE_KEY)
  const id = raw === null ? NaN : Number(raw)
  return Number.isInteger(id) ? id : null
}

export const useOrganizationStore = defineStore('organization', () => {
  const organizations = ref<Organization[]>([])
  const activeId = ref<number | null>(null)
  const loaded = ref(false)
  const version = ref(0)
  let generation = 0

  const active = computed(() => organizations.value.find((o) => o.id === activeId.value) ?? null)

  function setActive(id: number | null): void {
    if (id === activeId.value) return
    activeId.value = id
    version.value++
    if (id !== null) localStorage.setItem(ORGANIZATION_STORAGE_KEY, String(id))
  }

  async function load(): Promise<void> {
    const current = ++generation
    const response = await api.get<{ data: Organization[] }>('/api/organizations')
    if (current !== generation) return
    organizations.value = response.data
    loaded.value = true
    const stored = readStoredId()
    const keep = [activeId.value, stored].find((id) => id !== null && response.data.some((o) => o.id === id))
    setActive(keep ?? response.data[0]?.id ?? null)
  }

  function select(id: number): void {
    if (!organizations.value.some((o) => o.id === id)) return
    setActive(id)
  }

  function clear(): void {
    generation++
    organizations.value = []
    loaded.value = false
    setActive(null)
  }

  return { organizations, activeId, active, loaded, version, load, select, clear }
})

export function installOrganizationOnApi(): void {
  const organization = useOrganizationStore()
  api.setOrganizationProvider(() => organization.activeId)
}
