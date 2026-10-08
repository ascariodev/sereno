import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import { useOrganizationStore } from './organization'
import { useProjectsStore } from './projects'

const project = (id: number, name: string, archived_at: string | null = null) => ({
  id,
  name,
  key: `K${id}`,
  description: null,
  archived_at,
  created_at: '',
  updated_at: '',
})
const channel = (id: number, project_id: number) => ({ id, project_id, name: `K${project_id}`, archived_at: null })
const meta = (last_page = 1) => ({ current_page: 1, last_page, per_page: 100, total: 1 })

function setup(activeId: number | null = 1) {
  setActivePinia(createPinia())
  useOrganizationStore().$patch({ activeId })
  return useProjectsStore()
}

describe('projects store', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('loads unarchived projects and maps project to channel', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      path === '/api/projects'
        ? ({ data: [project(1, 'Alpha'), project(2, 'Old', '2026-01-01')], meta: meta() } as never)
        : ({ data: [channel(7, 1)] } as never),
    )
    const store = setup()
    await flushPromises()
    expect(store.projects.map((p) => p.name)).toEqual(['Alpha'])
    expect(store.channelByProject).toEqual({ 1: 7 })
    expect(store.loading).toBe(false)
    expect(store.failed).toBe(false)
  })

  it('requests every page', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string, options?: { query?: Record<string, unknown> }) => {
      if (path !== '/api/projects') return { data: [] } as never
      const page = options?.query?.page
      return { data: [project(page as number, `P${page}`)], meta: meta(2) } as never
    })
    const store = setup()
    await flushPromises()
    const pages = get.mock.calls.filter(([path]) => path === '/api/projects').map(([, o]) => (o as { query: { page: number } }).query.page)
    expect(pages).toEqual([1, 2])
    expect(store.projects).toHaveLength(2)
  })

  it('reloads when the active organization changes', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      path === '/api/projects' ? ({ data: [project(1, 'A')], meta: meta() } as never) : ({ data: [] } as never),
    )
    setup()
    await flushPromises()
    const before = get.mock.calls.length
    useOrganizationStore().$patch({ activeId: 2 })
    await flushPromises()
    expect(get.mock.calls.length).toBe(before + 2)
  })

  it('discards a stale response after switching organization', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    let projectCalls = 0
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path !== '/api/projects') return Promise.resolve({ data: [] } as never)
      projectCalls++
      if (projectCalls === 1) return new Promise((resolve) => (resolveFirst = resolve)) as never
      return Promise.resolve({ data: [project(2, 'Fresh')], meta: meta() } as never)
    })
    const store = setup()
    useOrganizationStore().$patch({ activeId: 2 })
    await flushPromises()
    resolveFirst({ data: [project(1, 'Stale')], meta: meta() })
    await flushPromises()
    expect(store.projects.map((p) => p.name)).toEqual(['Fresh'])
    expect(store.loading).toBe(false)
  })

  it('does not repopulate when the organization is cleared while loading', async () => {
    let resolveProjects: (value: unknown) => void = () => {}
    vi.spyOn(api, 'get').mockImplementation((path: string) =>
      path === '/api/projects'
        ? (new Promise((resolve) => (resolveProjects = resolve)) as never)
        : Promise.resolve({ data: [channel(7, 1)] } as never),
    )
    const store = setup()
    useOrganizationStore().$patch({ activeId: null })
    await flushPromises()
    resolveProjects({ data: [project(1, 'Stale')], meta: meta() })
    await flushPromises()
    expect(store.projects).toEqual([])
    expect(store.channelByProject).toEqual({})
    expect(store.loading).toBe(false)
  })

  it('does not load without an active organization', async () => {
    const get = vi.spyOn(api, 'get')
    const store = setup(null)
    await flushPromises()
    expect(get).not.toHaveBeenCalled()
    expect(store.projects).toEqual([])
  })

  it('flags failure and retries with reload', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, 'boom'))
    const store = setup()
    await flushPromises()
    expect(store.failed).toBe(true)
    expect(store.loading).toBe(false)
    get.mockImplementation(async (path: string) =>
      path === '/api/projects' ? ({ data: [project(1, 'A')], meta: meta() } as never) : ({ data: [] } as never),
    )
    await store.reload()
    expect(store.failed).toBe(false)
    expect(store.projects).toHaveLength(1)
  })
})
