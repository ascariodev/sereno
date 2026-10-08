import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { i18n, setLocale } from '../i18n'
import { createAppRouter } from '../router'
import { TOKEN_STORAGE_KEY, useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import MembersView from './MembersView.vue'

const user = { id: 1, name: 'Ada', email: 'ada@e.com', locale: 'en' }

function member(id: number, role: 'owner' | 'admin' | 'member' | null, overrides: Record<string, unknown> = {}) {
  return { id, name: `User ${id}`, email: `u${id}@e.com`, role, joined_at: '2026-10-08T12:00:00Z', ...overrides }
}

function organizations() {
  return [{ id: 1, name: 'Acme', slug: 'acme', settings: null, roles: ['member'] }]
}

let wrapper: VueWrapper | undefined

async function mountView(members: unknown[] = []) {
  localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().$patch({ user })
  const organization = useOrganizationStore()
  organization.$patch({ organizations: organizations(), activeId: 1, loaded: true })
  const get = vi.spyOn(api, 'get').mockResolvedValue({ data: members })
  const router = createAppRouter(createMemoryHistory())
  wrapper = mount(MembersView, { attachTo: document.body, global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return { get, organization }
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  setLocale('en')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

describe('MembersView', () => {
  it('lists name, email, role and join date, and marks the current user', async () => {
    const { get } = await mountView([member(1, 'owner'), member(2, 'member'), member(3, null, { joined_at: null })])
    expect(get).toHaveBeenCalledWith('/api/members', { signal: expect.any(AbortSignal) })
    const rows = wrapper!.findAll('[data-test=member]')
    expect(rows).toHaveLength(3)
    expect(rows[0].find('[data-test=name]').text()).toBe('User 1')
    expect(rows[0].find('[data-test=email]').text()).toBe('u1@e.com')
    expect(rows[0].find('[data-test=role]').text()).toBe('Owner')
    expect(rows[0].find('[data-test=joined]').text()).toMatch(/2026/)
    expect(rows[0].find('[data-test=you]').exists()).toBe(true)
    expect(rows[1].find('[data-test=you]').exists()).toBe(false)
    expect(rows[2].find('[data-test=role]').text()).toBe('No role')
    expect(rows[2].find('[data-test=joined]').text()).toBe('-')
  })

  it('shows the empty state', async () => {
    await mountView([])
    expect(wrapper!.find('[data-test=empty]').exists()).toBe(true)
  })

  it('shows an error with retry when the list fails', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().$patch({ user })
    useOrganizationStore().$patch({ organizations: organizations(), activeId: 1, loaded: true })
    const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(500, 'boom', {}))
    wrapper = mount(MembersView, { attachTo: document.body, global: { plugins: [pinia, i18n, createAppRouter(createMemoryHistory())] } })
    await flushPromises()
    expect(wrapper.find('[data-test=load-failed]').exists()).toBe(true)
    get.mockResolvedValue({ data: [member(2, 'admin')] })
    await wrapper.find('button[name=retry]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test=load-failed]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test=member]')).toHaveLength(1)
  })

  it('reloads the list when the active organization changes and discards the stale response', async () => {
    const { get, organization } = await mountView([member(1, 'owner')])
    let resolveFirst: (value: unknown) => void = () => undefined
    get.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    organization.organizations = [
      ...organization.organizations,
      { id: 2, name: 'Other', slug: 'other', settings: null, roles: ['member'] },
    ]
    organization.select(2)
    await flushPromises()
    expect(wrapper!.findAll('[data-test=member]')).toHaveLength(0)
    expect(wrapper!.find('[data-test=loading]').exists()).toBe(true)
    get.mockResolvedValue({ data: [member(5, 'member')] })
    organization.organizations = [
      ...organization.organizations,
      { id: 3, name: 'Third', slug: 'third', settings: null, roles: ['member'] },
    ]
    organization.select(3)
    await flushPromises()
    resolveFirst({ data: [member(9, 'owner'), member(10, 'owner')] })
    await flushPromises()
    const rows = wrapper!.findAll('[data-test=member]')
    expect(rows).toHaveLength(1)
    expect(rows[0].find('[data-test=name]').text()).toBe('User 5')
    expect(get.mock.calls.filter(([path]) => path === '/api/members')).toHaveLength(3)
  })
})
