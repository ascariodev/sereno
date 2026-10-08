import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import type { LogGroup } from '../api/types'
import { i18n } from '../i18n'
import { setRealtimeClientFactory } from '../realtime/echo'
import { createAppRouter } from '../router'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { createFakeRealtimeClient } from '../test/fakeRealtimeClient'
import { toast, toasts } from '../components/ui/toast'
import LogView from './LogView.vue'

const project = { id: 5, name: 'posveapi', key: 'POSVE', description: 'Sales', archived_at: null, created_at: '', updated_at: '' }
const group = (id: number, overrides: Partial<LogGroup> = {}): LogGroup => ({
  id,
  project_id: 5,
  level: 'error',
  title: `Timeout ${id}`,
  status: 'open',
  events_count: id * 10,
  first_seen_at: '2026-10-01T10:00:00Z',
  last_seen_at: '2026-10-02T10:00:00Z',
  ...overrides,
})
const page = (data: LogGroup[], current = 1, last = 1) => ({
  data,
  links: {},
  meta: { current_page: current, last_page: last, per_page: 20, total: data.length },
})

type Query = Record<string, unknown>
let mounted: ReturnType<typeof mount> | undefined

function groupCalls(spy: { mock: { calls: unknown[][] } }): Query[] {
  return spy.mock.calls
    .filter(([path]) => path === '/api/projects/5/log-groups')
    .map(([, options]) => (options as { query: Query }).query)
}

function hourlyCalls(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .filter(([path]) => path === '/api/projects/5/log-groups/hourly')
    .map(([, options]) => (options as { query: { ids: string } }).query.ids)
}

function projectCalls(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter(([path]) => path === '/api/projects').length
}

const hourlyBody = (counts: Record<string, number[]>) => ({ data: { from: '', hours: 24, counts } })

function mockApi(groups: (query: Query) => unknown, hourly: (query: Query, signal?: AbortSignal) => unknown = () => hourlyBody({})) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string, options?: { query?: Query; signal?: AbortSignal }) => {
    if (path === '/api/projects') return { data: [project], meta: { last_page: 1 } } as never
    if (path === '/api/channels') return { data: [{ id: 7, project_id: 5, name: 'general' }] } as never
    if (path === '/api/projects/5/log-groups') return (await groups(options?.query ?? {})) as never
    if (path === '/api/projects/5/log-groups/hourly') return (await hourly(options?.query ?? {}, options?.signal)) as never
    if (path.startsWith('/api/projects/5/log-groups/')) return { data: group(1) } as never
    return undefined as never
  })
}

async function mountView(path = '/projects/5/log') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().$patch({ token: 't', user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } })
  useOrganizationStore().$patch({ activeId: 1 })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  const wrapper = mount(LogView, { global: { plugins: [pinia, i18n, router] }, attachTo: document.body })
  mounted = wrapper
  await flushPromises()
  return Object.assign(wrapper, { router })
}

describe('LogView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setRealtimeClientFactory(() => null)
  })
  afterEach(() => {
    vi.useRealTimers()
    mounted?.unmount()
    mounted = undefined
    document.body.innerHTML = ''
  })

  it('lists open groups by default with level, title, events and status', async () => {
    const spy = mockApi(() => page([group(1), group(2, { level: 'critical', status: 'resolved' })]))
    const wrapper = await mountView()
    expect(groupCalls(spy)).toEqual([{ status: 'open', level: undefined, page: 1, per_page: undefined }])
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Timeout 1')
    expect(rows[0].text()).toContain('10')
    expect(rows[1].find('[data-level=critical]').exists()).toBe(true)
    expect(rows[1].find('[data-status=resolved]').exists()).toBe(true)
    expect(wrapper.find('h1').text()).toContain('posveapi')
    expect(wrapper.find('[aria-label="Status"] [aria-pressed=true]').text()).toContain('Open')
  })

  it('filters by status and level through the URL and goes back with history', async () => {
    const spy = mockApi(() => page([group(1)]))
    const wrapper = await mountView()

    const resolved = wrapper.findAll('[aria-label="Status"] button').find((b) => b.text().includes('Resolved'))!
    await resolved.trigger('click')
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query).toEqual({ status: 'resolved' })
    expect(groupCalls(spy).at(-1)?.status).toBe('resolved')

    const select = wrapper.find('select[name=level]')
    await select.setValue('error')
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query).toEqual({ status: 'resolved', level: 'error' })
    expect(groupCalls(spy).at(-1)).toMatchObject({ status: 'resolved', level: 'error' })

    const all = wrapper.findAll('[aria-label="Status"] button').find((b) => b.text().includes('All'))!
    await all.trigger('click')
    await flushPromises()
    expect(groupCalls(spy).at(-1)?.status).toBeUndefined()
    expect(wrapper.router.currentRoute.value.query.status).toBe('all')

    wrapper.router.back()
    await flushPromises()
    expect(groupCalls(spy).at(-1)).toMatchObject({ status: 'resolved', level: 'error' })
  })

  it('reads the filters from the URL and ignores invalid values', async () => {
    const spy = mockApi(() => page([group(1)]))
    const wrapper = await mountView('/projects/5/log?status=ignored&level=warning&page=abc')
    expect(groupCalls(spy)).toEqual([{ status: 'ignored', level: 'warning', page: 1, per_page: undefined }])
    expect((wrapper.find('select[name=level]').element as HTMLSelectElement).value).toBe('warning')
    expect(wrapper.find('[aria-label="Status"] [aria-pressed=true]').text()).toContain('Ignored')

    mounted?.unmount()
    const invalid = await mountView('/projects/5/log?status=zzz&level=nope')
    expect(groupCalls(spy).at(-1)).toMatchObject({ status: 'open', level: undefined })
    expect((invalid.find('select[name=level]').element as HTMLSelectElement).value).toBe('all')
  })

  it('paginates through the URL and resets the page when a filter changes', async () => {
    const spy = mockApi((query) => page([group(Number(query.page ?? 1))], Number(query.page ?? 1), 3))
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Page 1 of 3')
    expect(wrapper.find('button[name=prev-page]').attributes('disabled')).toBeDefined()

    await wrapper.find('button[name=next-page]').trigger('click')
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query).toEqual({ page: '2' })
    expect(groupCalls(spy).at(-1)?.page).toBe(2)
    expect(wrapper.text()).toContain('Page 2 of 3')

    await wrapper.find('select[name=level]').setValue('error')
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query).toEqual({ level: 'error' })

    await wrapper.router.push('/projects/5/log?page=3')
    await flushPromises()
    expect(wrapper.find('button[name=next-page]').attributes('disabled')).toBeDefined()
  })

  it('moves to the last page when the requested one is out of range', async () => {
    const spy = mockApi((query) => page(Number(query.page) > 2 ? [] : [group(1)], 2, 2))
    const wrapper = await mountView('/projects/5/log?page=9')
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query).toEqual({ page: '2' })
    expect(groupCalls(spy).at(-1)?.page).toBe(2)
  })

  it('discards a stale response when the filters change quickly', async () => {
    const resolvers: Record<string, (value: unknown) => void> = {}
    mockApi(
      (query) =>
        new Promise((resolve) => {
          resolvers[String(query.status)] = resolve
        }),
    )
    const wrapper = await mountView()
    await wrapper.router.push('/projects/5/log?status=resolved')
    await nextTick()
    resolvers.resolved(page([group(2, { title: 'fresh' })]))
    await flushPromises()
    resolvers.open(page([group(1, { title: 'stale' })]))
    await flushPromises()
    expect(wrapper.text()).toContain('fresh')
    expect(wrapper.text()).not.toContain('stale')
  })

  it('requests the hourly counts once per page and renders a sparkline per group', async () => {
    const spy = mockApi(
      () => page([group(1), group(2)]),
      () => hourlyBody({ '1': [0, 3, 1], '2': [2, 0, 0] }),
    )
    const wrapper = await mountView()
    expect(hourlyCalls(spy)).toEqual(['1,2'])
    const rows = wrapper.findAll('tbody tr')
    expect(rows[0].find('.sparkline').exists()).toBe(true)
    expect(rows[0].find('.sparkline').text()).toContain('4')
    expect(rows[1].find('.sparkline').exists()).toBe(true)
  })

  it('discards a stale hourly response when a newer page loads', async () => {
    const resolvers: Record<string, (value: unknown) => void> = {}
    const signals: Record<string, AbortSignal> = {}
    const spy = mockApi(
      (query) => page([group(Number(query.page ?? 1))], Number(query.page ?? 1), 3),
      (query, signal) =>
        new Promise((resolve, reject) => {
          signals[String(query.ids)] = signal!
          resolvers[String(query.ids)] = resolve
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
    const wrapper = await mountView()
    await wrapper.router.push('/projects/5/log?page=2')
    await flushPromises()
    expect(hourlyCalls(spy)).toEqual(['1', '2'])
    expect(signals['1'].aborted).toBe(true)
    expect(signals['2'].aborted).toBe(false)
    resolvers['2'](hourlyBody({ '2': [5, 5] }))
    await flushPromises()
    resolvers['1'](hourlyBody({ '1': [9, 9] }))
    await flushPromises()
    const row = wrapper.find('tbody tr')
    expect(row.find('.sparkline').text()).toContain('10')
    expect(wrapper.text()).not.toContain('18')
  })

  it('keeps the list without sparklines when the hourly request fails', async () => {
    mockApi(
      () => page([group(1)]),
      () => {
        throw new ApiError(500, 'boom')
      },
    )
    const wrapper = await mountView()
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('.sparkline').exists()).toBe(false)
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
  })

  it('opens the detail panel from a row and closes it, keeping the filters', async () => {
    mockApi(() => page([group(1), group(2)]))
    const wrapper = await mountView('/projects/5/log?level=error')
    await wrapper.findAll('a.log-view__group')[1].trigger('click')
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query).toEqual({ level: 'error', group: '2' })
    expect(wrapper.find('aside').exists()).toBe(true)

    await wrapper.find('aside button').trigger('click')
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query).toEqual({ level: 'error' })
    expect(wrapper.find('aside').exists()).toBe(false)
  })

  it('shows the empty state, a retryable error and not found', async () => {
    let mode: 'empty' | 'fail' = 'empty'
    mockApi(() => {
      if (mode === 'fail') throw new Error('boom')
      return page([])
    })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('No log groups match these filters.')
    expect(wrapper.find('table').exists()).toBe(false)

    mode = 'fail'
    await wrapper.router.push('/projects/5/log?status=all')
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('Could not load the log groups.')

    mode = 'empty'
    await wrapper.find('button[name=retry]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
  })

  it('shows not found without retry when the project does not exist', async () => {
    mockApi(() => {
      throw new ApiError(404, 'Not found')
    })
    const wrapper = await mountView()
    expect(wrapper.find('[role=alert]').text()).toContain('This project does not exist')
    expect(wrapper.find('button[name=retry]').exists()).toBe(false)
  })

  it('aborts the pending request on unmount and on organization change', async () => {
    const signals: AbortSignal[] = []
    vi.spyOn(api, 'get').mockImplementation(async (path: string, options?: { signal?: AbortSignal }) => {
      if (path === '/api/projects') return { data: [project], meta: { last_page: 1 } } as never
      if (path === '/api/channels') return { data: [] } as never
      if (path === '/api/projects/5/log-groups') {
        signals.push(options!.signal!)
        return new Promise(() => {}) as never
      }
      return undefined as never
    })
    const wrapper = await mountView()
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)
    useOrganizationStore().$patch({ activeId: 2 })
    await flushPromises()
    expect(signals).toHaveLength(2)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    wrapper.unmount()
    expect(signals[1].aborted).toBe(true)
  })

  it('clears the group and the page when the organization changes', async () => {
    mockApi((query) => page([group(1)], Number(query.page ?? 1), 3))
    const wrapper = await mountView('/projects/5/log?status=all&group=1&page=2')
    expect(wrapper.find('aside').exists()).toBe(true)
    const replace = vi.spyOn(wrapper.router, 'replace')
    const push = vi.spyOn(wrapper.router, 'push')
    useOrganizationStore().$patch({ activeId: 2 })
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query).toEqual({ status: 'all' })
    expect(wrapper.find('aside').exists()).toBe(false)
    expect(replace).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('loads once, not twice, when the organization changes with group and page in the URL', async () => {
    const spy = mockApi((query) => page([group(1)], Number(query.page ?? 1), 3))
    await mountView('/projects/5/log?status=all&group=1&page=2')
    const listCalls = () => spy.mock.calls.filter(([path]) => path === '/api/projects/5/log-groups').length
    const before = listCalls()
    useOrganizationStore().$patch({ activeId: 2 })
    await flushPromises()
    expect(listCalls() - before).toBe(1)
  })

  it('loads once when the organization changes with only a group in the URL', async () => {
    const spy = mockApi((query) => page([group(1)], Number(query.page ?? 1), 3))
    const wrapper = await mountView('/projects/5/log?status=all&group=1')
    const listCalls = () => spy.mock.calls.filter(([path]) => path === '/api/projects/5/log-groups').length
    const before = listCalls()
    useOrganizationStore().$patch({ activeId: 2 })
    await flushPromises()
    expect(listCalls() - before).toBe(1)
    expect(wrapper.router.currentRoute.value.query).toEqual({ status: 'all' })
  })

  it('closes the panel replacing the history entry when the group is not found', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/projects') return { data: [project], meta: { last_page: 1 } } as never
      if (path === '/api/channels') return { data: [] } as never
      if (path === '/api/projects/5/log-groups') return page([group(1)]) as never
      throw new ApiError(404, 'Not found')
    })
    toast.clear()
    const wrapper = await mountView('/projects/5/log?status=all&group=99')
    expect(wrapper.router.currentRoute.value.query).toEqual({ status: 'all' })
    expect(wrapper.find('aside').exists()).toBe(false)
    expect(toasts.value.map((item) => item.message)).toEqual(['This log group does not exist or you cannot access it.'])
    wrapper.router.back()
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query.group).toBeUndefined()
  })

  it('reloads the list when the panel resolves a group', async () => {
    const spy = mockApi(() => page([group(1)]))
    const wrapper = await mountView('/projects/5/log?group=1')
    const before = groupCalls(spy).length
    vi.spyOn(api, 'patch').mockResolvedValue({ data: group(1, { status: 'resolved' }) } as never)
    await wrapper.find('aside button[name=resolve]').trigger('click')
    await flushPromises()
    expect(groupCalls(spy).length).toBe(before + 1)
  })

  it('refreshes the project counts after resolving a group from the panel', async () => {
    const spy = mockApi(() => page([group(1)]))
    const wrapper = await mountView('/projects/5/log?group=1')
    const before = projectCalls(spy)
    vi.spyOn(api, 'patch').mockResolvedValue({ data: group(1, { status: 'resolved' }) } as never)
    vi.useFakeTimers()
    await wrapper.find('aside button[name=resolve]').trigger('click')
    await vi.advanceTimersByTimeAsync(300)
    expect(projectCalls(spy)).toBe(before + 1)
  })

  it('links the Channel and Log tabs and marks Log as current', async () => {
    mockApi(() => page([group(1)]))
    const wrapper = await mountView('/projects/5/log?status=all')
    const tabs = wrapper.findAll('nav[aria-label="Project views"] a')
    expect(tabs.map((tab) => tab.attributes('href'))).toEqual(['/channels/7', '/projects/5/log'])
    expect(tabs[0].attributes('aria-current')).toBeUndefined()
    expect(tabs[1].attributes('aria-current')).toBe('page')

    await tabs[0].trigger('click')
    await vi.waitFor(() => expect(wrapper.router.currentRoute.value.name).toBe('channel'))
  })

  describe('realtime', () => {
    const statusMessage = (id: number, channelId = 7) => ({
      id,
      channel_id: channelId,
      kind: 'system' as const,
      body: null,
      payload: { type: 'log.group_status_changed', log_group_id: 1, status: 'resolved', previous_status: 'open' },
      log_group_id: 1,
      user: null,
      created_at: '2026-10-02T10:00:00Z',
    })

    function fakeRealtime() {
      const { client, listeners, setStatus } = createFakeRealtimeClient()
      setRealtimeClientFactory(() => client)
      const emit = (message: unknown) => listeners.get('organizations.1.channels.7|.message.created')?.({ message } as never)
      return { client, emit, setStatus }
    }

    it('reloads the list once, debounced, when another person changes a group status', async () => {
      const realtime = fakeRealtime()
      const spy = mockApi(() => page([group(1)]))
      await mountView()
      expect(realtime.client.private).toHaveBeenCalledWith('organizations.1.channels.7')
      const before = groupCalls(spy).length
      vi.useFakeTimers()
      realtime.emit(statusMessage(10))
      realtime.emit(statusMessage(11))
      await vi.advanceTimersByTimeAsync(299)
      expect(groupCalls(spy)).toHaveLength(before)
      await vi.advanceTimersByTimeAsync(1)
      expect(groupCalls(spy)).toHaveLength(before + 1)
    })

    it('does not reload when the listed row already has the announced status', async () => {
      const realtime = fakeRealtime()
      const spy = mockApi(() => page([group(1, { status: 'resolved' })]))
      await mountView()
      const before = groupCalls(spy).length
      vi.useFakeTimers()
      realtime.emit(statusMessage(10))
      await vi.advanceTimersByTimeAsync(1000)
      expect(groupCalls(spy)).toHaveLength(before)
    })

    it('ignores other messages and reloads after a reconnection', async () => {
      const realtime = fakeRealtime()
      const spy = mockApi(() => page([group(1)]))
      await mountView()
      const before = groupCalls(spy).length
      vi.useFakeTimers()
      realtime.emit({ ...statusMessage(10), payload: { type: 'log.group_opened', log_group_id: 1 } })
      realtime.emit({ ...statusMessage(11), kind: 'user', payload: null })
      await vi.advanceTimersByTimeAsync(1000)
      expect(groupCalls(spy)).toHaveLength(before)
      realtime.setStatus('connected')
      realtime.setStatus('disconnected')
      realtime.setStatus('connected')
      await vi.advanceTimersByTimeAsync(0)
      expect(groupCalls(spy)).toHaveLength(before + 1)
    })

    it('refreshes the project counts once, after 300 ms, for opened and status notices', async () => {
      const realtime = fakeRealtime()
      const spy = mockApi(() => page([group(1, { status: 'resolved' })]))
      await mountView()
      const before = projectCalls(spy)
      vi.useFakeTimers()
      realtime.emit({ ...statusMessage(10), kind: 'user', payload: null })
      await vi.advanceTimersByTimeAsync(1000)
      expect(projectCalls(spy)).toBe(before)
      realtime.emit({ ...statusMessage(11), payload: { type: 'log.group_opened', log_group_id: 2, level: 'error', title: 'T', events_count: 1 } })
      realtime.emit(statusMessage(12))
      await vi.advanceTimersByTimeAsync(299)
      expect(projectCalls(spy)).toBe(before)
      await vi.advanceTimersByTimeAsync(1)
      expect(projectCalls(spy)).toBe(before + 1)
    })

    it('refreshes the project counts after a reconnection', async () => {
      const realtime = fakeRealtime()
      const spy = mockApi(() => page([group(1)]))
      await mountView()
      realtime.setStatus('connected')
      await flushPromises()
      const before = projectCalls(spy)
      vi.useFakeTimers()
      realtime.setStatus('disconnected')
      realtime.setStatus('connected')
      await vi.advanceTimersByTimeAsync(300)
      expect(projectCalls(spy)).toBe(before + 1)
    })

    it('leaves the channel and drops a pending reload on unmount', async () => {
      const realtime = fakeRealtime()
      const spy = mockApi(() => page([group(1)]))
      const wrapper = await mountView()
      const before = groupCalls(spy).length
      vi.useFakeTimers()
      realtime.emit(statusMessage(10))
      wrapper.unmount()
      mounted = undefined
      await vi.advanceTimersByTimeAsync(1000)
      expect(realtime.client.leave).toHaveBeenCalledWith('organizations.1.channels.7')
      expect(groupCalls(spy)).toHaveLength(before)
    })
  })
})
