import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { i18n } from '../i18n'
import { createAppRouter } from '../router'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'
import { useTasksStore } from '../stores/tasks'
import PlanView from './PlanView.vue'

enableAutoUnmount(afterEach)

const project = (id: number, key: string) => ({ id, name: `proj${id}`, key, description: null, archived_at: null, created_at: '', updated_at: '' })

function mockApi(tasks: (path: string) => unknown = () => ({ data: [] })) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/api/projects') return { data: [project(5, 'POSVE'), project(6, 'OTHER')], meta: { last_page: 1 } } as never
    if (path === '/api/channels') return { data: [{ id: 7, project_id: 5, name: 'general' }] } as never
    if (/^\/api\/projects\/\d+\/tasks$/.test(path)) return (await tasks(path)) as never
    return undefined as never
  })
}

const taskCalls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map(([path]) => path).filter((path) => /\/tasks$/.test(String(path)))

async function mountView(path = '/projects/5/plan') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().$patch({ token: 't', user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } })
  useOrganizationStore().$patch({ activeId: 1 })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  const wrapper = mount(PlanView, { global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return Object.assign(wrapper, { router })
}

describe('PlanView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    useProjectsStore().clear()
    useTasksStore().clear()
  })

  it('opens the project, shows the header with Plan current and clears on unmount', async () => {
    const spy = mockApi()
    const wrapper = await mountView()
    expect(taskCalls(spy)).toEqual(['/api/projects/5/tasks'])
    expect(useTasksStore().projectId).toBe(5)
    expect(wrapper.find('h1').text()).toContain('proj5')
    const current = wrapper.find('nav[aria-label="Project views"] a[aria-current=page]')
    expect(current.attributes('href')).toBe('/projects/5/plan')
    wrapper.unmount()
    expect(useTasksStore().projectId).toBeNull()
  })

  it('shows loading while the tasks load', async () => {
    let release: (value: unknown) => void = () => {}
    mockApi(() => new Promise((resolve) => (release = resolve)))
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Loading...')
    release({ data: [] })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Loading...')
  })

  it('reopens when the route changes to another project', async () => {
    const spy = mockApi()
    const wrapper = await mountView()
    await wrapper.router.push('/projects/6/plan')
    await flushPromises()
    expect(taskCalls(spy)).toEqual(['/api/projects/5/tasks', '/api/projects/6/tasks'])
    expect(useTasksStore().projectId).toBe(6)
  })

  it('does not reopen when only the query changes', async () => {
    const spy = mockApi()
    const wrapper = await mountView()
    await wrapper.router.push('/projects/5/plan?task=3')
    await flushPromises()
    expect(taskCalls(spy)).toHaveLength(1)
  })

  it('shows an error with retry on failure', async () => {
    let fail = true
    const spy = mockApi(() => {
      if (fail) throw new ApiError(500, 'boom')
      return { data: [] }
    })
    const wrapper = await mountView()
    expect(wrapper.find('[role=alert]').text()).toContain('Could not load the tasks.')
    fail = false
    await wrapper.find('button[name=retry]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    expect(taskCalls(spy)).toHaveLength(2)
  })

  it('shows not found on a 404', async () => {
    mockApi(() => {
      throw new ApiError(404, 'nope')
    })
    const wrapper = await mountView()
    expect(wrapper.find('[role=alert]').text()).toContain('does not exist')
  })

  it('shows not found for an invalid project id without loading', async () => {
    const spy = mockApi()
    const invalid = await mountView('/projects/abc/plan')
    expect(invalid.find('[role=alert]').text()).toContain('does not exist')
    expect(taskCalls(spy)).toHaveLength(0)
  })
})
