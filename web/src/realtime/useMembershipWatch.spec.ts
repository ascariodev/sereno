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
import { MEMBERSHIP_REVOKED_EVENT, setRealtimeClientFactory } from './echo'
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
  setRealtimeClientFactory(() => null)
})

describe('useMembershipWatch', () => {
  it('subscribes to the user channel', async () => {
    await mountWatch()
    expect(fake.client.private).toHaveBeenCalledWith('users.1')
    expect(fake.listeners.has(`users.1|${MEMBERSHIP_REVOKED_EVENT}`)).toBe(true)
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

  it('unmounting drops the user channel and the reconnect listener', async () => {
    await mountWatch()
    wrapper!.unmount()
    wrapper = undefined
    expect(fake.client.leave).toHaveBeenCalledWith('users.1')
    expect(fake.statusListeners.size).toBe(0)
  })

  it('reloads the organizations after a reconnection', async () => {
    const { get } = await mountWatch()
    fake.setStatus('connected')
    expect(organizationLoads(get)).toBe(0)
    fake.setStatus('disconnected')
    fake.setStatus('connected')
    await flushPromises()
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
})
