import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import { leaveOrganization } from '../realtime/echo'
import { useAuthStore } from './auth'
import { ORGANIZATION_STORAGE_KEY, installOrganizationOnApi, useOrganizationStore } from './organization'

vi.mock('../realtime/echo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../realtime/echo')>()),
  leaveOrganization: vi.fn(),
}))

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

  it('create posts, reloads and activates the new organization', async () => {
    const store = setup()
    await store.load()
    const created = { id: 3, name: 'Three', slug: 'three', settings: null, roles: ['owner'] }
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: created })
    vi.spyOn(api, 'get').mockResolvedValue({ data: [...orgs, created] })
    const result = await store.create('Three')
    expect(post).toHaveBeenCalledWith('/api/organizations', { name: 'Three' })
    expect(result).toEqual(created)
    expect(store.activeId).toBe(3)
    expect(localStorage.getItem(ORGANIZATION_STORAGE_KEY)).toBe('3')
  })

  it('create from the empty state activates the new organization', async () => {
    const store = setup([])
    await store.load()
    const created = { id: 3, name: 'Three', slug: 'three', settings: null, roles: ['owner'] }
    vi.spyOn(api, 'post').mockResolvedValue({ data: created })
    vi.spyOn(api, 'get').mockResolvedValue({ data: [created] })
    await store.create('Three')
    expect(store.activeId).toBe(3)
  })

  it('create rethrows a 422 and keeps the active organization', async () => {
    const store = setup()
    await store.load()
    const error = new ApiError(422, 'Invalid', { name: ['The name field is required.'] })
    vi.spyOn(api, 'post').mockRejectedValue(error)
    const get = vi.mocked(api.get)
    get.mockClear()
    await expect(store.create('')).rejects.toBe(error)
    expect(store.activeId).toBe(1)
    expect(get).not.toHaveBeenCalled()
  })

  it('create does not repopulate the store when clear runs meanwhile', async () => {
    const store = setup()
    await store.load()
    let resolve!: (value: { data: unknown }) => void
    vi.spyOn(api, 'post').mockReturnValue(new Promise((r) => (resolve = r)))
    const pending = store.create('Three')
    store.clear()
    resolve({ data: { id: 3, name: 'Three', slug: 'three', settings: null, roles: ['owner'] } })
    await pending
    expect(store.organizations).toEqual([])
    expect(store.activeId).toBeNull()
  })

  it('feeds the api client header provider', async () => {
    const store = setup()
    const setProvider = vi.spyOn(api, 'setOrganizationProvider')
    installOrganizationOnApi()
    await store.load()
    expect(setProvider.mock.calls[0][0]?.()).toBe(1)
  })

  it('revoking the active organization leaves its channels and switches to another', async () => {
    const store = setup()
    await store.load()
    vi.spyOn(api, 'get').mockResolvedValue({ data: [orgs[1]] })
    const changed = await store.handleMembershipRevoked(1)
    expect(leaveOrganization).toHaveBeenCalledWith(1)
    expect(changed).toBe(true)
    expect(store.activeId).toBe(2)
  })

  it('revoking the only organization leaves no active one', async () => {
    const store = setup([orgs[0]])
    await store.load()
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] })
    const changed = await store.handleMembershipRevoked(1)
    expect(changed).toBe(true)
    expect(store.activeId).toBeNull()
    expect(store.loaded).toBe(true)
  })

  it('revoking a non active organization keeps the active one', async () => {
    const store = setup()
    await store.load()
    vi.spyOn(api, 'get').mockResolvedValue({ data: [orgs[0]] })
    const changed = await store.handleMembershipRevoked(2)
    expect(leaveOrganization).toHaveBeenCalledWith(2)
    expect(changed).toBe(false)
    expect(store.activeId).toBe(1)
    expect(store.organizations).toEqual([orgs[0]])
  })

  it('a forbidden when the organization is gone leaves it and switches to another', async () => {
    const store = setup()
    await store.load()
    vi.spyOn(api, 'get').mockResolvedValue({ data: [orgs[1]] })
    expect(await store.handleForbidden(1)).toBe(true)
    expect(leaveOrganization).toHaveBeenCalledWith(1)
    expect(store.activeId).toBe(2)
  })

  it('a forbidden while the organization is still listed changes nothing', async () => {
    const store = setup()
    await store.load()
    vi.spyOn(api, 'get').mockResolvedValue({ data: orgs })
    expect(await store.handleForbidden(1)).toBe(false)
    expect(leaveOrganization).not.toHaveBeenCalled()
    expect(store.activeId).toBe(1)
  })

  it('a revoke reload in flight when clear runs is discarded', async () => {
    const store = setup()
    await store.load()
    let resolve!: (value: { data: typeof orgs }) => void
    vi.spyOn(api, 'get').mockReturnValue(new Promise((r) => (resolve = r)))
    const pending = store.handleMembershipRevoked(1)
    store.clear()
    resolve({ data: [orgs[1]] })
    expect(await pending).toBe(false)
    expect(store.organizations).toEqual([])
    expect(store.activeId).toBeNull()
  })

  it('a newer load that changes the active organization still reports the change', async () => {
    const store = setup()
    await store.load()
    const resolvers: Array<(value: { data: typeof orgs }) => void> = []
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((r) => resolvers.push(r)))
    const revoked = store.handleMembershipRevoked(1)
    const reconnect = store.load()
    resolvers[1]({ data: [orgs[1]] })
    await reconnect
    resolvers[0]({ data: orgs })
    expect(await revoked).toBe(true)
    expect(store.activeId).toBe(2)
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

  it('canRemoveMember mirrors MemberPolicy::remove by the active role', async () => {
    const store = setup([
      { id: 1, name: 'One', slug: 'one', settings: null, roles: ['owner'] },
      { id: 2, name: 'Two', slug: 'two', settings: null, roles: ['admin'] },
      { id: 3, name: 'Three', slug: 'three', settings: null, roles: ['member'] },
    ])
    const targets = ['owner', 'admin', 'member', null] as const
    expect(targets.map((role) => store.canRemoveMember(role))).toEqual([false, false, false, false])
    await store.load()
    expect(targets.map((role) => store.canRemoveMember(role))).toEqual([true, true, true, true])
    store.select(2)
    expect(targets.map((role) => store.canRemoveMember(role))).toEqual([false, true, true, true])
    store.select(3)
    expect(targets.map((role) => store.canRemoveMember(role))).toEqual([false, false, false, false])
  })
})
