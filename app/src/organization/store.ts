import { create } from 'zustand'

import { api, ApiError } from '@/api/client'
import { ORGANIZATION_STORAGE_KEY, readStored, removeStored, writeStored } from '@/session/storage'

export interface Organization {
  id: number
  name: string
  slug: string
  roles?: string[]
}

interface OrganizationState {
  organizations: Organization[]
  activeId: number | null
  loaded: boolean
  loadError: boolean
  active(): Organization | null
  load(): Promise<void>
  select(id: number): Promise<void>
  create(name: string): Promise<Organization>
  handleForbidden(organizationId: number): Promise<void>
  clear(): void
}

// Bumped on every load and on clear(): a response that started under another value is discarded.
let loadGeneration = 0
let clearCount = 0

function parseStoredId(raw: string | null): number | null {
  const id = raw === null ? NaN : Number(raw)
  return Number.isInteger(id) ? id : null
}

async function persist(id: number): Promise<void> {
  try {
    await writeStored(ORGANIZATION_STORAGE_KEY, String(id))
  } catch {
    // the choice still applies for this run
  }
}

export const useOrganizationStore = create<OrganizationState>()((set, get) => ({
  organizations: [],
  activeId: null,
  loaded: false,
  loadError: false,

  active() {
    const { organizations, activeId } = get()
    return organizations.find((organization) => organization.id === activeId) ?? null
  },

  async load() {
    const mine = ++loadGeneration
    set({ loadError: false })
    try {
      const [response, stored] = await Promise.all([
        api.get<{ data: Organization[] }>('/api/organizations'),
        get().activeId === null ? readStored(ORGANIZATION_STORAGE_KEY) : Promise.resolve(null),
      ])
      if (mine !== loadGeneration) return
      const candidate = get().activeId ?? parseStoredId(stored)
      const listed = response.data.some((organization) => organization.id === candidate)
      const keep = listed ? candidate : (response.data[0]?.id ?? null)
      set({ organizations: response.data, loaded: true, activeId: keep })
      if (keep === null) await removeStored(ORGANIZATION_STORAGE_KEY)
      else if (keep !== candidate) await persist(keep)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (mine === loadGeneration) set({ loadError: true })
    }
  },

  async select(id) {
    const mine = clearCount
    if (!get().organizations.some((organization) => organization.id === id)) return
    set({ activeId: id })
    await persist(id)
    if (mine !== clearCount) await removeStored(ORGANIZATION_STORAGE_KEY)
  },

  async create(name) {
    const mine = clearCount
    const response = await api.post<{ data: Organization }>('/api/organizations', { name })
    const created = response.data
    if (mine !== clearCount) return created
    await get().load()
    if (mine !== clearCount) return created
    if (!get().organizations.some((organization) => organization.id === created.id)) {
      set({ organizations: [...get().organizations, created], loaded: true })
    }
    await get().select(created.id)
    return created
  },

  async handleForbidden(organizationId) {
    if (get().activeId !== organizationId) return
    await get().load()
  },

  clear() {
    loadGeneration++
    clearCount++
    set({ organizations: [], activeId: null, loaded: false, loadError: false })
  },
}))

export function installOrganizationOnApi(): void {
  api.setOrganizationProvider(() => useOrganizationStore.getState().activeId)
  api.setForbiddenHandler((organizationId) => {
    void useOrganizationStore.getState().handleForbidden(organizationId)
  })
}
