import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  describe('create', () => {
    it('posts the project, reloads and exposes the project with its channel', async () => {
      let created = false
      vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
        path === '/api/projects'
          ? ({ data: created ? [project(5, 'Fresh')] : [], meta: meta() } as never)
          : ({ data: created ? [channel(9, 5)] : [] } as never),
      )
      const post = vi.spyOn(api, 'post').mockImplementation(async () => {
        created = true
        return { data: project(5, 'Fresh') } as never
      })
      const store = setup()
      await flushPromises()
      const result = await store.create({ name: 'Fresh', key: 'K5', description: 'About' })
      expect(post).toHaveBeenCalledWith('/api/projects', { name: 'Fresh', key: 'K5', description: 'About' })
      expect(result.id).toBe(5)
      expect(store.projects.map((p) => p.name)).toEqual(['Fresh'])
      expect(store.channelByProject).toEqual({ 5: 9 })
    })

    it('propagates the error and leaves the list untouched', async () => {
      const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
        path === '/api/projects' ? ({ data: [project(1, 'A')], meta: meta() } as never) : ({ data: [channel(7, 1)] } as never),
      )
      vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid', { key: ['taken'] }))
      const store = setup()
      await flushPromises()
      const before = get.mock.calls.length
      await expect(store.create({ name: 'B', key: 'K1' })).rejects.toMatchObject({ status: 422 })
      expect(get.mock.calls.length).toBe(before)
      expect(store.projects.map((p) => p.name)).toEqual(['A'])
      expect(store.channelByProject).toEqual({ 1: 7 })
    })
  })

  describe('refreshCounts', () => {
    afterEach(() => vi.useRealTimers())

    const counted = (id: number, name: string, open_groups_count: number, open_max_level: string | null) => ({
      ...project(id, name),
      open_groups_count,
      open_max_level,
    })

    async function loaded(responses: () => Promise<unknown>) {
      const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
        path === '/api/projects'
          ? ({ data: [counted(1, 'Alpha', 0, null), counted(2, 'Beta', 1, 'warning')], meta: meta() } as never)
          : ({ data: [channel(7, 1)] } as never),
      )
      const store = setup()
      await flushPromises()
      get.mockImplementation(((path: string) =>
        path === '/api/projects' ? responses() : Promise.resolve({ data: [] })) as never)
      vi.useFakeTimers()
      return { store, get }
    }
    const projectCalls = (get: { mock: { calls: unknown[][] } }) => get.mock.calls.filter(([path]) => path === '/api/projects').length

    it('waits 300 ms, requests once and updates only the counts, keeping the list', async () => {
      const { store, get } = await loaded(async () => ({
        data: [counted(1, 'Renamed', 3, 'critical'), counted(2, 'Beta', 1, 'warning'), counted(9, 'New', 2, 'error')],
        meta: meta(),
      }))
      const before = projectCalls(get)
      const beta = store.projects[1]
      store.refreshCounts()
      store.refreshCounts()
      await vi.advanceTimersByTimeAsync(299)
      expect(projectCalls(get)).toBe(before)
      await vi.advanceTimersByTimeAsync(1)
      expect(projectCalls(get)).toBe(before + 1)
      expect(store.projects.map((p) => [p.id, p.name, p.open_groups_count, p.open_max_level])).toEqual([
        [1, 'Alpha', 3, 'critical'],
        [2, 'Beta', 1, 'warning'],
      ])
      expect(store.projects[1]).toBe(beta)
      expect(store.channelByProject).toEqual({ 1: 7 })
    })

    it('discards an older response that arrives after a newer one', async () => {
      const pending: ((value: unknown) => void)[] = []
      const { store } = await loaded(() => new Promise((resolve) => pending.push(resolve)))
      store.refreshCounts()
      await vi.advanceTimersByTimeAsync(300)
      store.refreshCounts()
      await vi.advanceTimersByTimeAsync(300)
      expect(pending).toHaveLength(2)
      pending[1]({ data: [counted(1, 'Alpha', 5, 'alert'), counted(2, 'Beta', 0, null)], meta: meta() })
      await vi.advanceTimersByTimeAsync(0)
      pending[0]({ data: [counted(1, 'Alpha', 4, 'error'), counted(2, 'Beta', 2, 'error')], meta: meta() })
      await vi.advanceTimersByTimeAsync(0)
      expect(store.projects.map((p) => [p.open_groups_count, p.open_max_level])).toEqual([
        [5, 'alert'],
        [0, null],
      ])
    })

    it('drops a pending wait and an in-flight response when the organization changes or clears', async () => {
      const pending: ((value: unknown) => void)[] = []
      const { store, get } = await loaded(() => new Promise((resolve) => pending.push(resolve)))
      store.refreshCounts()
      await vi.advanceTimersByTimeAsync(300)
      expect(pending).toHaveLength(1)
      store.refreshCounts()
      useOrganizationStore().$patch({ activeId: null })
      await vi.advanceTimersByTimeAsync(1000)
      expect(pending).toHaveLength(1)
      pending[0]({ data: [counted(1, 'Alpha', 4, 'error')], meta: meta() })
      await vi.advanceTimersByTimeAsync(0)
      expect(store.projects).toEqual([])
      expect(projectCalls(get)).toBeGreaterThan(0)
    })

    it('re-arms the refresh while a reload is pending instead of losing it', async () => {
      const pending: ((value: unknown) => void)[] = []
      const { store, get } = await loaded(() => new Promise((resolve) => pending.push(resolve)))
      const reloading = store.reload()
      expect(store.loading).toBe(true)
      expect(pending).toHaveLength(1)
      store.refreshCounts()
      await vi.advanceTimersByTimeAsync(900)
      expect(pending).toHaveLength(1)
      pending[0]({ data: [counted(1, 'Alpha', 0, null), counted(2, 'Beta', 1, 'warning')], meta: meta() })
      await reloading
      expect(store.loading).toBe(false)
      const before = projectCalls(get)
      await vi.advanceTimersByTimeAsync(300)
      expect(projectCalls(get)).toBe(before + 1)
      pending[1]({ data: [counted(1, 'Alpha', 6, 'critical'), counted(2, 'Beta', 1, 'warning')], meta: meta() })
      await vi.advanceTimersByTimeAsync(0)
      expect(store.projects.map((p) => p.open_groups_count)).toEqual([6, 1])
    })

    it('keeps the previous counts when the refresh fails', async () => {
      const { store } = await loaded(() => Promise.reject(new ApiError(500, 'boom')))
      store.refreshCounts()
      await vi.advanceTimersByTimeAsync(300)
      expect(store.projects.map((p) => p.open_groups_count)).toEqual([0, 1])
      expect(store.failed).toBe(false)
    })
  })
})
