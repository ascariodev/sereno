import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { api, ApiError } from '../api/client'
import { toast, toasts } from '../components/ui/toast'
import { i18n, setLocale } from '../i18n'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { createFakeRealtimeClient } from '../test/fakeRealtimeClient'
import {
  MEMBERSHIP_REVOKED_EVENT,
  MEMBERSHIP_ROLE_CHANGED_EVENT,
  setRealtimeClientFactory,
  subscribeToChannel,
} from './echo'
import { expectOwnLeave, useMembershipWatch } from './useMembershipWatch'

const user = { id: 1, name: 'Ada', email: 'a@e.com', locale: 'en' }
const one = { id: 1, name: 'One', slug: 'one', settings: null, roles: ['member'] }
const two = { id: 2, name: 'Two', slug: 'two', settings: null, roles: ['member'] }

let wrapper: VueWrapper | undefined
let fake: ReturnType<typeof createFakeRealtimeClient>

async function mountWatch(remaining: unknown[] = [two]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().$patch({ token: 'tok', user })
  const organization = useOrganizationStore()
  organization.$patch({ organizations: [one, two], activeId: 1, loaded: true })
  const get = vi.spyOn(api, 'get').mockResolvedValue({ data: remaining })
  const page = defineComponent({ template: '<p />' })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'projects', component: page },
      { path: '/channels/:id', name: 'channel', component: page },
    ],
  })
  await router.push('/channels/7')
  await router.isReady()
  const Host = defineComponent({
    setup() {
      useMembershipWatch()
    },
    template: '<RouterView />',
  })
  wrapper = mount(Host, { global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return { get, router, organization }
}

function revoke(organizationId: number) {
  fake.listeners.get(`users.1|${MEMBERSHIP_REVOKED_EVENT}`)?.({ organization_id: organizationId })
}

function changeRole(organizationId: number, role: string) {
  fake.listeners.get(`users.1|${MEMBERSHIP_ROLE_CHANGED_EVENT}`)?.({ organization_id: organizationId, role })
}

function reconnect() {
  fake.setStatus('connected')
  fake.setStatus('disconnected')
  fake.setStatus('connected')
}

function denyChannel(organizationId: number, status: number | undefined) {
  const name = `organizations.${organizationId}.channels.7`
  subscribeToChannel(organizationId, 7, () => {})
  fake.rejectChannel(name, { type: 'AuthError', status })
}

function organizationLoads(get: { mock: { calls: unknown[][] } }) {
  return get.mock.calls.filter(([path]) => path === '/api/organizations').length
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  toast.clear()
  setLocale('en')
  fake = createFakeRealtimeClient()
  setRealtimeClientFactory(() => fake.client)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  api.setOrganizationProvider(null)
  setRealtimeClientFactory(() => null)
})

describe('useMembershipWatch', () => {
  it('subscribes to the user channel', async () => {
    await mountWatch()
    expect(fake.client.private).toHaveBeenCalledWith('users.1')
    expect(fake.listeners.has(`users.1|${MEMBERSHIP_REVOKED_EVENT}`)).toBe(true)
  })

  it('on a role change reloads the organizations and bumps the roles revision', async () => {
    const { get, router, organization } = await mountWatch([{ ...one, roles: ['admin'] }, two])
    changeRole(1, 'admin')
    await flushPromises()
    expect(organizationLoads(get)).toBe(1)
    expect(organization.isAdmin).toBe(true)
    expect(organization.rolesRevision).toBe(1)
    expect(router.currentRoute.value.name).toBe('channel')
    expect(toasts.value).toHaveLength(0)
  })

  it('ignores a role change the store already reflects', async () => {
    const { get, organization } = await mountWatch()
    changeRole(1, 'member')
    await flushPromises()
    expect(organizationLoads(get)).toBe(0)
    expect(organization.rolesRevision).toBe(0)
  })

  it('a role change in another organization reloads without bumping the revision', async () => {
    const { get, organization } = await mountWatch([one, { ...two, roles: ['owner'] }])
    changeRole(2, 'owner')
    await flushPromises()
    expect(organizationLoads(get)).toBe(1)
    expect(organization.rolesRevision).toBe(0)
  })

  it('stays quiet when the role-change reload fails', async () => {
    const { get, organization } = await mountWatch()
    get.mockRejectedValue(new ApiError(500, 'boom', {}))
    changeRole(1, 'admin')
    await flushPromises()
    expect(organization.rolesRevision).toBe(0)
    expect(toasts.value).toHaveLength(0)
  })

  it('on losing the active organization reloads, notifies and goes to projects', async () => {
    const { router, organization } = await mountWatch([two])
    revoke(1)
    await flushPromises()
    expect(organization.activeId).toBe(2)
    expect(router.currentRoute.value.name).toBe('projects')
    expect(toasts.value.map((item) => [item.kind, item.message])).toEqual([['info', 'You no longer belong to One.']])
  })

  it('on losing the last organization leaves no active one', async () => {
    const { router, organization } = await mountWatch([])
    revoke(1)
    await flushPromises()
    expect(organization.activeId).toBeNull()
    expect(router.currentRoute.value.name).toBe('projects')
    expect(toasts.value).toHaveLength(1)
  })

  it('on losing another organization only reloads the list', async () => {
    const { get, router, organization } = await mountWatch([one])
    revoke(2)
    await flushPromises()
    expect(organizationLoads(get)).toBe(1)
    expect(organization.organizations.map((o) => o.id)).toEqual([1])
    expect(organization.activeId).toBe(1)
    expect(router.currentRoute.value.name).toBe('channel')
    expect(toasts.value).toHaveLength(0)
  })

  it('stays quiet when the reload fails', async () => {
    const { get, router } = await mountWatch()
    get.mockRejectedValue(new ApiError(500, 'boom', {}))
    revoke(1)
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('channel')
    expect(toasts.value).toHaveLength(0)
  })

  it('an own leave only cuts the channels', async () => {
    const { get, router } = await mountWatch()
    const release = expectOwnLeave(1)
    revoke(1)
    await flushPromises()
    release()
    expect(organizationLoads(get)).toBe(0)
    expect(router.currentRoute.value.name).toBe('channel')
    expect(toasts.value).toHaveLength(0)
  })

  it('after releasing an own leave the notice is handled again', async () => {
    const { router } = await mountWatch()
    const release = expectOwnLeave(1)
    release()
    release()
    revoke(1)
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('projects')
    expect(toasts.value).toHaveLength(1)
  })

  it('logout disconnects and drops the user channel', async () => {
    const { get } = await mountWatch()
    useAuthStore().clearSession()
    await flushPromises()
    expect(fake.client.disconnect).toHaveBeenCalled()
    revoke(1)
    await flushPromises()
    expect(organizationLoads(get)).toBe(0)
  })

  it('joins the session channel', async () => {
    await mountWatch()
    expect(fake.client.join).toHaveBeenCalledWith('sessions.1')
  })

  it('unmounting drops the user and session channels, the reconnect and the denied listeners', async () => {
    const { get } = await mountWatch()
    wrapper!.unmount()
    wrapper = undefined
    expect(fake.client.leave).toHaveBeenCalledWith('users.1')
    expect(fake.client.leave).toHaveBeenCalledWith('sessions.1')
    expect(fake.statusListeners.size).toBe(0)
    denyChannel(1, 403)
    await flushPromises()
    expect(organizationLoads(get)).toBe(0)
  })

  it('a reconnection with the membership intact reloads quietly', async () => {
    const { get, router } = await mountWatch([one, two])
    fake.setStatus('connected')
    expect(organizationLoads(get)).toBe(0)
    fake.setStatus('disconnected')
    fake.setStatus('connected')
    await flushPromises()
    expect(organizationLoads(get)).toBe(1)
    expect(router.currentRoute.value.name).toBe('channel')
    expect(toasts.value).toHaveLength(0)
  })

  it('a reconnection that finds the active membership gone toasts and goes to projects', async () => {
    const { router, organization } = await mountWatch([two])
    reconnect()
    await flushPromises()
    expect(organization.activeId).toBe(2)
    expect(router.currentRoute.value.name).toBe('projects')
    expect(toasts.value.map((item) => [item.kind, item.message])).toEqual([['info', 'You no longer belong to One.']])
  })

  it('a reconnection without an active organization only reloads', async () => {
    const { get, organization } = await mountWatch([one])
    organization.$patch({ activeId: null })
    reconnect()
    await flushPromises()
    expect(organizationLoads(get)).toBe(1)
    expect(toasts.value).toHaveLength(0)
  })

  it('a reconnection during an own leave of the active organization only reloads', async () => {
    const { get, router } = await mountWatch([two])
    const release = expectOwnLeave(1)
    reconnect()
    await flushPromises()
    release()
    expect(organizationLoads(get)).toBe(1)
    expect(router.currentRoute.value.name).toBe('channel')
    expect(toasts.value).toHaveLength(0)
  })

  it('a 403 on an active organization channel whose membership is gone toasts and navigates', async () => {
    const { router, organization } = await mountWatch([two])
    denyChannel(1, 403)
    await flushPromises()
    expect(organization.activeId).toBe(2)
    expect(router.currentRoute.value.name).toBe('projects')
    expect(toasts.value).toHaveLength(1)
  })

  it('a 403 on a channel with the membership intact does not toast', async () => {
    const { get, router } = await mountWatch([one, two])
    denyChannel(1, 403)
    await flushPromises()
    expect(organizationLoads(get)).toBe(1)
    expect(router.currentRoute.value.name).toBe('channel')
    expect(toasts.value).toHaveLength(0)
  })

  it('ignores a channel rejection without a 403', async () => {
    const { get } = await mountWatch([two])
    denyChannel(1, undefined)
    denyChannel(1, 500)
    await flushPromises()
    expect(organizationLoads(get)).toBe(0)
    expect(toasts.value).toHaveLength(0)
  })

  it('ignores a 403 on a channel of an organization that is not active', async () => {
    const { get } = await mountWatch([one])
    denyChannel(2, 403)
    await flushPromises()
    expect(organizationLoads(get)).toBe(0)
  })

  it('the cut after the revocation event notifies once', async () => {
    const { get, router } = await mountWatch([two])
    revoke(1)
    reconnect()
    await flushPromises()
    reconnect()
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('projects')
    expect(toasts.value).toHaveLength(1)
    expect(organizationLoads(get)).toBe(2)
  })

  it('a cut without the event notifies once for the reconnection and the rejected channel', async () => {
    const { get, router } = await mountWatch([two])
    reconnect()
    denyChannel(1, 403)
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('projects')
    expect(toasts.value).toHaveLength(1)
    expect(organizationLoads(get)).toBe(1)
  })

  it('listens for reconnections on a new client created after disconnecting with the layout mounted', async () => {
    const { get } = await mountWatch()
    const next = createFakeRealtimeClient()
    setRealtimeClientFactory(() => next.client)
    useAuthStore().$patch({ user: { ...user, id: 2 } })
    await flushPromises()
    expect(fake.statusListeners.size).toBe(0)
    expect(next.statusListeners.size).toBe(1)
    next.setStatus('connected')
    next.setStatus('disconnected')
    next.setStatus('connected')
    await flushPromises()
    expect(organizationLoads(get)).toBe(1)
  })

  function mockFetch(organizations: unknown[]) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).endsWith('/api/organizations')
        ? new Response(JSON.stringify({ data: organizations }), { status: 200 })
        : new Response('{"message":"Forbidden."}', { status: 403 }),
    )
  }

  it('a 403 from the active organization whose membership is gone toasts and navigates once', async () => {
    const { router, organization, get } = await mountWatch()
    get.mockRestore()
    const fetchSpy = mockFetch([two])
    api.setOrganizationProvider(() => 1)
    await api.get('/api/projects').catch(() => undefined)
    revoke(1)
    await flushPromises()
    expect(organization.activeId).toBe(2)
    expect(toasts.value).toHaveLength(1)
    expect(router.currentRoute.value.name).toBe('projects')
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/api/organizations'))).toHaveLength(1)
  })

  it('an ordinary 403 with the membership intact does not toast or navigate', async () => {
    const { router, organization, get } = await mountWatch([one, two])
    get.mockRestore()
    mockFetch([one, two])
    api.setOrganizationProvider(() => 1)
    await api.get('/api/projects').catch(() => undefined)
    await flushPromises()
    expect(organization.activeId).toBe(1)
    expect(toasts.value).toHaveLength(0)
    expect(router.currentRoute.value.name).toBe('channel')
  })

  it('ignores a 403 for an organization that is no longer active', async () => {
    const { get } = await mountWatch()
    get.mockRestore()
    const fetchSpy = mockFetch([one, two])
    api.setOrganizationProvider(() => 2)
    await api.get('/api/projects').catch(() => undefined)
    await flushPromises()
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/api/organizations'))).toHaveLength(0)
  })
})
