import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { i18n } from '../i18n'
import { createAppRouter } from '../router'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'
import { openProjectCreateKey } from '../composables/useProjectCreate'
import ProjectsView from './ProjectsView.vue'

const project = (id: number, name: string, archived_at: string | null = null) => ({
  id,
  name,
  key: `K${id}`,
  description: null,
  archived_at,
  created_at: '',
  updated_at: '',
})
const channel = (id: number, project_id: number) => ({
  id,
  project_id,
  name: `K${project_id}`,
  archived_at: null,
  created_at: '',
  project: { id: project_id, name: '', key: '' },
})

async function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useOrganizationStore().$patch({ activeId: 1 })
  useAuthStore().$patch({ user: { id: 1, name: 'Sergio', email: 's@x.test', locale: 'en' } })
  const router = createAppRouter(createMemoryHistory())
  const wrapper = mount(ProjectsView, { global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return wrapper
}

describe('ProjectsView', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('lists unarchived projects linked to their channel', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      path === '/api/projects'
        ? ({ data: [project(1, 'Alpha'), project(2, 'Old', '2026-01-01')], meta: { current_page: 1, last_page: 1, per_page: 100, total: 2 } } as never)
        : ({ data: [channel(7, 1)] } as never),
    )
    const wrapper = await mountView()
    expect(get).toHaveBeenCalledWith('/api/projects', { query: { per_page: 100, page: 1 } })
    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).not.toContain('Old')
    expect(wrapper.find('a').attributes('href')).toBe('/channels/7')
  })

  it('requests every page and concatenates the projects', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string, options?: { query?: Record<string, unknown> }) => {
      if (path !== '/api/projects') return { data: [] } as never
      const page = options?.query?.page
      return {
        data: page === 1 ? [project(1, 'Alpha')] : [project(2, 'Beta')],
        meta: { current_page: page, last_page: 2, per_page: 1, total: 2 },
      } as never
    })
    const wrapper = await mountView()
    const queries = get.mock.calls.filter(([path]) => path === '/api/projects').map(([, options]) => (options as { query: { page: number } }).query.page)
    expect(queries).toEqual([1, 2])
    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).toContain('Beta')
  })

  it('reloads when the active organization changes', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      path === '/api/projects'
        ? ({ data: [project(get.mock.calls.length, `P${get.mock.calls.length}`)], meta: { current_page: 1, last_page: 1, per_page: 100, total: 1 } } as never)
        : ({ data: [] } as never),
    )
    const wrapper = await mountView()
    const before = get.mock.calls.length
    useOrganizationStore().$patch({ activeId: 2 })
    await flushPromises()
    expect(get.mock.calls.length).toBe(before + 2)
    expect(wrapper.findAll('li')).toHaveLength(1)
  })

  it('discards a stale response after switching organization', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    let projectCalls = 0
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path !== '/api/projects') return Promise.resolve({ data: [] } as never)
      projectCalls++
      if (projectCalls === 1) return new Promise((resolve) => (resolveFirst = resolve)) as never
      return Promise.resolve({ data: [project(2, 'Fresh')], meta: { current_page: 1, last_page: 1, per_page: 100, total: 1 } } as never)
    })
    const wrapper = await mountView()
    useOrganizationStore().$patch({ activeId: 2 })
    await flushPromises()
    resolveFirst({ data: [project(1, 'Stale')], meta: { current_page: 1, last_page: 1, per_page: 100, total: 1 } })
    await flushPromises()
    expect(wrapper.text()).toContain('Fresh')
    expect(wrapper.text()).not.toContain('Stale')
  })

  it('keeps the list visible while reloading after create and shows loading with an empty list', async () => {
    const page = { current_page: 1, last_page: 1, per_page: 100, total: 1 }
    let hold = false
    let resolveReload: (value: unknown) => void = () => {}
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path !== '/api/projects') return Promise.resolve({ data: [] } as never)
      if (hold) return new Promise((resolve) => (resolveReload = resolve)) as never
      return Promise.resolve({ data: [project(1, 'Alpha')], meta: page } as never)
    })
    vi.spyOn(api, 'post').mockImplementation(async () => {
      hold = true
      return { data: project(2, 'Beta') } as never
    })
    const wrapper = await mountView()
    const store = useProjectsStore()
    const creating = store.create({ name: 'Beta', key: 'K2' })
    await flushPromises()
    expect(store.loading).toBe(true)
    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).not.toContain(i18n.global.t('common.loading'))
    resolveReload({ data: [project(1, 'Alpha'), project(2, 'Beta')], meta: page })
    await creating
    await flushPromises()
    expect(wrapper.findAll('li')).toHaveLength(2)

    void store.reload()
    await flushPromises()
    expect(wrapper.text()).toContain(i18n.global.t('common.loading'))
    expect(wrapper.findAll('li')).toHaveLength(0)
  })

  it('shows an error on failure', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, 'boom'))
    const wrapper = await mountView()
    expect(wrapper.find('[role=alert]').exists()).toBe(true)
  })

  it('greets the user by name', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [], meta: { current_page: 1, last_page: 1, per_page: 100, total: 0 } } as never)
    const wrapper = await mountView()
    expect(wrapper.find('h1').text()).toBe('Hello, Sergio')
  })

  it('shows the empty state without projects', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [], meta: { current_page: 1, last_page: 1, per_page: 100, total: 0 } } as never)
    const wrapper = await mountView()
    expect(wrapper.find('.projects__empty').text()).toContain('No projects yet.')
    expect(wrapper.findAll('li')).toHaveLength(0)
  })

  it('renders a project without channel as a card without link', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      path === '/api/projects'
        ? ({ data: [{ ...project(1, 'Alpha'), description: 'Does things' }], meta: { current_page: 1, last_page: 1, per_page: 100, total: 1 } } as never)
        : ({ data: [] } as never),
    )
    const wrapper = await mountView()
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toContain('K1')
    expect(wrapper.text()).toContain('Does things')
  })

  it('labels the card link by name and describes it by description', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      path === '/api/projects'
        ? ({ data: [{ ...project(1, 'Alpha'), description: 'Does things' }], meta: { current_page: 1, last_page: 1, per_page: 100, total: 1 } } as never)
        : ({ data: [channel(7, 1)] } as never),
    )
    const wrapper = await mountView()
    const link = wrapper.find('a')
    expect(link.attributes('aria-labelledby')).toBe('project-1-name')
    expect(link.attributes('aria-describedby')).toBe('project-1-description')
    expect(link.find('#project-1-name').text()).toBe('Alpha')
    expect(link.find('#project-1-description').text()).toBe('Does things')
  })

  const withChannel = (extra: Record<string, unknown>) =>
    vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      path === '/api/projects'
        ? ({ data: [{ ...project(1, 'Alpha'), ...extra }], meta: { current_page: 1, last_page: 1, per_page: 100, total: 1 } } as never)
        : ({ data: [channel(7, 1)] } as never),
    )

  it('shows open groups and the highest level on the card', async () => {
    withChannel({ open_groups_count: 3, open_max_level: 'error' })
    const wrapper = await mountView()
    const health = wrapper.find('#project-1-health')
    expect(health.text()).toBe('3 open · error')
    expect(health.attributes('data-tone')).toBe('error')
    expect(wrapper.find('a').attributes('aria-describedby')).toBe('project-1-health')
  })

  it('uses the singular form for one open group', async () => {
    withChannel({ open_groups_count: 1, open_max_level: 'warning' })
    const wrapper = await mountView()
    expect(wrapper.find('#project-1-health').text()).toBe('1 open · warning')
  })

  it('shows all calm without open groups', async () => {
    withChannel({ description: 'Does things', open_groups_count: 0, open_max_level: null })
    const wrapper = await mountView()
    expect(wrapper.find('#project-1-health').text()).toBe('All calm')
    expect(wrapper.find('a').attributes('aria-describedby')).toBe('project-1-description project-1-health')
  })

  it('shows no health line when the fields are absent', async () => {
    withChannel({})
    const wrapper = await mountView()
    expect(wrapper.find('#project-1-health').exists()).toBe(false)
    expect(wrapper.find('a').attributes('aria-describedby')).toBeUndefined()
  })

  describe('create project entry', () => {
    const setRoles = (roles: string[]) =>
      useOrganizationStore().$patch({ organizations: [{ id: 1, name: 'One', slug: 'one', settings: null, roles }] })

    async function mountWith(roles: string[], open: () => void) {
      vi.spyOn(api, 'get').mockResolvedValue({ data: [], meta: { current_page: 1, last_page: 1, per_page: 100, total: 0 } } as never)
      const pinia = createPinia()
      setActivePinia(pinia)
      useOrganizationStore().$patch({ activeId: 1 })
      setRoles(roles)
      useAuthStore().$patch({ user: { id: 1, name: 'Sergio', email: 's@x.test', locale: 'en' } })
      const router = createAppRouter(createMemoryHistory())
      const wrapper = mount(ProjectsView, {
        global: { plugins: [pinia, i18n, router], provide: { [openProjectCreateKey as symbol]: open } },
      })
      await flushPromises()
      return wrapper
    }

    it.each([['owner'], ['admin']])('shows both buttons to %s and each opens the dialog', async (role) => {
      const open = vi.fn()
      const wrapper = await mountWith([role], open)
      await wrapper.find('button[name=create-project]').trigger('click')
      await wrapper.find('button[name=create-project-empty]').trigger('click')
      expect(open).toHaveBeenCalledTimes(2)
    })

    it('hides the buttons from a member and keeps the empty state', async () => {
      const wrapper = await mountWith(['member'], vi.fn())
      expect(wrapper.find('button[name=create-project]').exists()).toBe(false)
      expect(wrapper.find('button[name=create-project-empty]').exists()).toBe(false)
      expect(wrapper.text()).toContain('No projects yet.')
    })
  })
})
