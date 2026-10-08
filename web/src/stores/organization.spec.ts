import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { useAuthStore } from './auth'
import { ORGANIZATION_STORAGE_KEY, installOrganizationOnApi, useOrganizationStore } from './organization'

const orgs = [
  { id: 1, name: 'One', slug: 'one', settings: null, roles: ['owner'] },
  { id: 2, name: 'Two', slug: 'two', settings: null, roles: ['member'] },
]

function setup(data = orgs) {
  setActivePinia(createPinia())
  vi.spyOn(api, 'get').mockResolvedValue({ data })
  return useOrganizationStore()
}

describe('organization store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('picks the first organization and persists it', async () => {
    const store = setup()
    await store.load()
    expect(api.get).toHaveBeenCalledWith('/api/organizations')
    expect(store.activeId).toBe(1)
    expect(store.active?.name).toBe('One')
    expect(localStorage.getItem(ORGANIZATION_STORAGE_KEY)).toBe('1')
  })

  it('picks the stored one when it still exists', async () => {
    localStorage.setItem(ORGANIZATION_STORAGE_KEY, '2')
    const store = setup()
    await store.load()
    expect(store.activeId).toBe(2)
  })

  it('falls back to the first when the stored one is gone', async () => {
    localStorage.setItem(ORGANIZATION_STORAGE_KEY, '99')
    const store = setup()
    await store.load()
    expect(store.activeId).toBe(1)
    expect(localStorage.getItem(ORGANIZATION_STORAGE_KEY)).toBe('1')
  })

  it('select changes, persists and bumps version; same or unknown id is ignored', async () => {
    const store = setup()
    await store.load()
    const before = store.version
    store.select(1)
    store.select(99)
    expect(store.version).toBe(before)
    store.select(2)
    expect(store.activeId).toBe(2)
    expect(store.version).toBe(before + 1)
    expect(localStorage.getItem(ORGANIZATION_STORAGE_KEY)).toBe('2')
  })

  it('without organizations there is no active one', async () => {
    const store = setup([])
    await store.load()
    expect(store.loaded).toBe(true)
    expect(store.activeId).toBeNull()
  })

  it('clear resets memory and bumps version but keeps the stored id', async () => {
    const store = setup()
    await store.load()
    const before = store.version
    store.clear()
    expect(store.organizations).toEqual([])
    expect(store.activeId).toBeNull()
    expect(store.loaded).toBe(false)
    expect(store.version).toBe(before + 1)
    expect(localStorage.getItem(ORGANIZATION_STORAGE_KEY)).toBe('1')
  })

  it('a load in flight when clear runs does not repopulate the store', async () => {
    const store = setup()
    let resolve!: (value: { data: typeof orgs }) => void
    vi.spyOn(api, 'get').mockReturnValue(new Promise((r) => (resolve = r)))
    const pending = store.load()
    store.clear()
    resolve({ data: orgs })
    await pending
    expect(store.organizations).toEqual([])
    expect(store.loaded).toBe(false)
    expect(store.activeId).toBeNull()
  })

  it('with overlapping loads the last started wins', async () => {
    const store = setup()
    const resolvers: Array<(value: { data: typeof orgs }) => void> = []
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((r) => resolvers.push(r)))
    const first = store.load()
    const second = store.load()
    resolvers[1]({ data: [orgs[1]] })
    await second
    resolvers[0]({ data: orgs })
    await first
    expect(store.organizations).toEqual([orgs[1]])
    expect(store.activeId).toBe(2)
  })

  it('clearing the auth session clears the active organization', async () => {
    const store = setup()
    await store.load()
    useAuthStore().clearSession()
    expect(store.activeId).toBeNull()
  })

  it('feeds the api client header provider', async () => {
    const store = setup()
    const setProvider = vi.spyOn(api, 'setOrganizationProvider')
    installOrganizationOnApi()
    await store.load()
    expect(setProvider.mock.calls[0][0]?.()).toBe(1)
  })

  it('derives owner and invitation management from the active roles', async () => {
    const store = setup([
      { id: 1, name: 'One', slug: 'one', settings: null, roles: ['owner'] },
      { id: 2, name: 'Two', slug: 'two', settings: null, roles: ['admin'] },
      { id: 3, name: 'Three', slug: 'three', settings: null, roles: ['member'] },
    ])
    expect(store.isOwner).toBe(false)
    expect(store.canManageInvitations).toBe(false)
    await store.load()
    expect([store.isOwner, store.canManageInvitations]).toEqual([true, true])
    store.select(2)
    expect([store.isOwner, store.canManageInvitations]).toEqual([false, true])
    store.select(3)
    expect([store.isOwner, store.canManageInvitations]).toEqual([false, false])
  })
})
