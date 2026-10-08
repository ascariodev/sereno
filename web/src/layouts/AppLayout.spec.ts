import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { i18n } from '../i18n'
import AppLayout from './AppLayout.vue'
import { createAppRouter } from '../router'
import { TOKEN_STORAGE_KEY, useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'

const user = { id: 1, name: 'Ada', email: 'a@e.com', locale: 'en' }
const project = {
  id: 5,
  name: 'posveapi',
  key: 'POSVE',
  description: null,
  archived_at: null,
  created_at: '',
  updated_at: '',
}
const orgs = [
  { id: 1, name: 'One', slug: 'one', settings: null, roles: ['owner'] },
  { id: 2, name: 'Two', slug: 'two', settings: null, roles: ['member'] },
]

function sidebarData(path: string): unknown {
  if (path === '/api/projects') return { data: [project], meta: { last_page: 1 } }
  if (path === '/api/channels') return { data: [{ id: 7, project_id: 5, name: 'general', project: { id: 5, name: 'posveapi' }, is_archived: false }] }
  if (path === '/api/channels/7/messages') return { data: [], meta: { next_cursor: null } }
  return undefined
}

async function mountApp(
  organizations: () => Promise<unknown> = async () => ({ data: orgs }),
  path = '/',
) {
  localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
  const pinia = createPinia()
  setActivePinia(pinia)
  vi.spyOn(api, 'get').mockImplementation(async (url: string) =>
    sidebarData(url) ?? (url === '/api/me' ? { data: user } : ((await organizations()) as never)),
  )
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('AppLayout', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('shows the user, the organizations and the page', async () => {
    const { wrapper } = await mountApp()
    expect(wrapper.text()).toContain('Ada')
    expect(wrapper.findAll('option').map((o) => o.text())).toEqual(['One', 'Two'])
    expect(wrapper.text()).toContain('Projects')
  })

  it('changing the selector changes the active organization', async () => {
    const { wrapper } = await mountApp()
    await wrapper.find('select').setValue('2')
    expect(useOrganizationStore().activeId).toBe(2)
  })

  it('shows a message without organizations and no page', async () => {
    const { wrapper } = await mountApp(async () => ({ data: [] }))
    expect(wrapper.text()).toContain('You do not belong to any organization yet.')
    expect(wrapper.text()).not.toContain('Projects')
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('shows an error when loading fails', async () => {
    const { wrapper } = await mountApp(async () => {
      throw new ApiError(500, 'boom')
    })
    expect(wrapper.find('[role=alert]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Projects')
  })

  it('only the latest overlapping load turns the loading state off', async () => {
    const pending: Array<() => void> = []
    const { wrapper } = await mountApp(
      () => new Promise((resolve) => pending.push(() => resolve({ data: orgs }))),
    )
    expect(wrapper.find('.app-layout__main > p').text()).toBe('Loading...')
    const layout = wrapper.findComponent(AppLayout)
    void (layout.vm as unknown as { loadOrganizations: () => Promise<void> }).loadOrganizations()
    await flushPromises()
    expect(pending).toHaveLength(2)
    pending[0]()
    await flushPromises()
    expect(wrapper.find('.app-layout__main > p').text()).toBe('Loading...')
    pending[1]()
    await flushPromises()
    expect(wrapper.find('.app-layout__main > p').exists()).toBe(false)
    expect(wrapper.text()).toContain('Projects')
  })

  it('lists the projects and marks the active one with aria-current', async () => {
    const { wrapper } = await mountApp(undefined, '/channels/7')
    const link = wrapper.find('a[href="/channels/7"]')
    expect(link.text()).toContain('POSVE')
    expect(link.text()).toContain('posveapi')
    expect(link.attributes('aria-current')).toBe('page')
    expect(wrapper.find('a[href="/"]').attributes('aria-current')).toBeUndefined()
  })

  it('marks Home as current on the home page', async () => {
    const { wrapper } = await mountApp()
    expect(wrapper.find('a[href="/"]').attributes('aria-current')).toBe('page')
    expect(wrapper.find('a[href="/channels/7"]').attributes('aria-current')).toBeUndefined()
  })

  it('logout clears the session and goes to login', async () => {
    const { wrapper, router } = await mountApp()
    vi.spyOn(api, 'post').mockResolvedValue(undefined)
    await wrapper.find('button[name=logout]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('login')
    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(useOrganizationStore().activeId).toBeNull()
  })
})
