import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { i18n } from '../i18n'
import { createAppRouter } from '../router'
import { useOrganizationStore } from '../stores/organization'
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

  it('shows an error on failure', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, 'boom'))
    const wrapper = await mountView()
    expect(wrapper.find('[role=alert]').exists()).toBe(true)
  })
})
