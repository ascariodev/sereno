import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import type { Message } from '../api/types'
import { toast, toasts } from '../components/ui/toast'
import { i18n } from '../i18n'
import { setRealtimeClientFactory } from '../realtime/echo'
import { createAppRouter } from '../router'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { createFakeRealtimeClient } from '../test/fakeRealtimeClient'
import ChannelView from './ChannelView.vue'

const message = (id: number, kind: Message['kind'] = 'user'): Message => ({
  id,
  channel_id: 7,
  kind,
  body: kind === 'user' ? `body ${id}` : null,
  payload: null,
  log_group_id: null,
  user: kind === 'user' ? { id: 1, name: 'Ana' } : null,
  created_at: '2026-01-01T00:00:00Z',
})
const channels = {
  data: [{ id: 7, project_id: 1, name: 'DEMO', archived_at: null, created_at: '', project: { id: 1, name: 'Demo', key: 'D' } }],
}

async function mountView(path = '/channels/7') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().$patch({ token: 't', user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } })
  useOrganizationStore().$patch({ activeId: 1 })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  const wrapper = mount(ChannelView, { global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return Object.assign(wrapper, { router })
}

function mockApi(messages: (cursor?: unknown) => unknown) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string, options?: { query?: { cursor?: unknown } }) => {
    if (path === '/api/channels') return channels as never
    if (path === '/api/projects') return { data: [], meta: { last_page: 1 } } as never
    return (await messages(options?.query?.cursor)) as never
  })
}

function viewCalls(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.filter(([path, options]) => path !== '/api/projects' && !(path === '/api/channels' && !options))
}

function fakeRealtime() {
  const { client, listeners, setStatus, statusListeners } = createFakeRealtimeClient()
  setRealtimeClientFactory(() => client)
  const emit = (name: string, payload: Message) => listeners.get(`${name}|.message.created`)?.({ message: payload })
  return { client, emit, setStatus, statusListeners }
}

describe('ChannelView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    toast.clear()
    setRealtimeClientFactory(() => null)
  })

  it('shows messages oldest first and a generic notice for system messages', async () => {
    mockApi(() => ({ data: [message(3), message(2, 'system'), message(1)], meta: { next_cursor: null } }))
    const wrapper = await mountView()
    const items = wrapper.findAll('li.message')
    expect(items).toHaveLength(3)
    expect(items[0].text()).toContain('body 1')
    expect(items[1].text()).toContain('System notice')
    expect(items[2].text()).toContain('body 3')
    expect(wrapper.find('h1').text()).toContain('DEMO')
  })

  it('loads older messages with the cursor without duplicates', async () => {
    mockApi((cursor) =>
      cursor ? { data: [message(2), message(1)], meta: { next_cursor: null } } : { data: [message(3), message(2)], meta: { next_cursor: 'c1' } },
    )
    const wrapper = await mountView()
    await wrapper.find('button[name="load-older"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('li.message').map((li) => li.text())).toEqual([
      expect.stringContaining('body 1'),
      expect.stringContaining('body 2'),
      expect.stringContaining('body 3'),
    ])
    expect(wrapper.find('button[name="load-older"]').exists()).toBe(false)
  })

  it('shows a message when the channel is not found (404)', async () => {
    mockApi(() => {
      throw new ApiError(404, 'Not found')
    })
    const wrapper = await mountView()
    expect(wrapper.find('[role="alert"]').text()).toContain('does not exist')
    expect(wrapper.find('ul').exists()).toBe(false)
  })

  it('shows a hint when the channel details fail to load but keeps the history', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/channels') throw new ApiError(500, 'Server error')
      return { data: [message(1)], meta: { next_cursor: null } } as never
    })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Could not load the channel details.')
    expect(wrapper.findAll('li.message')).toHaveLength(1)
  })

  it('ignores a stale channel request that fails after the organization changed', async () => {
    let rejectStale: (error: unknown) => void = () => {}
    let channelCalls = 0
    vi.spyOn(api, 'get').mockImplementation(async (path: string, options?: unknown) => {
      if (path === '/api/channels' && options) {
        channelCalls++
        if (channelCalls === 1) return new Promise((_, reject) => (rejectStale = reject)) as never
        return channels as never
      }
      return { data: [message(1)], meta: { next_cursor: null } } as never
    })
    const wrapper = await mountView()
    useOrganizationStore().$patch({ activeId: 2 })
    await flushPromises()
    rejectStale(new ApiError(500, 'Server error'))
    await flushPromises()
    expect(channelCalls).toBe(2)
    expect(wrapper.find('h1').text()).toContain('DEMO')
    expect(wrapper.text()).not.toContain('channel details')
  })

  it('does not show the details hint on a 404', async () => {
    vi.spyOn(api, 'get').mockImplementation(async () => {
      throw new ApiError(404, 'Not found')
    })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('does not exist')
    expect(wrapper.text()).not.toContain('channel details')
  })

  it('does not show the details hint when loading succeeds', async () => {
    mockApi(() => ({ data: [message(1)], meta: { next_cursor: null } }))
    const wrapper = await mountView()
    expect(wrapper.text()).not.toContain('channel details')
  })

  it('shows the project key and description from the projects store', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/channels') return channels as never
      if (path === '/api/projects') {
        const project = { id: 1, name: 'Demo', key: 'DMO', description: 'Full project description', archived_at: null, created_at: '', updated_at: '' }
        return { data: [project], meta: { last_page: 1 } } as never
      }
      return { data: [message(1)], meta: { next_cursor: null } } as never
    })
    const wrapper = await mountView()
    expect(wrapper.find('.project-key').text()).toBe('DMO')
    expect(wrapper.find('.project-header__description').text()).toBe('Full project description')
  })

  it('reloads when the organization changes', async () => {
    const get = mockApi(() => ({ data: [message(1)], meta: { next_cursor: null } }))
    await mountView()
    const before = viewCalls(get).length
    useOrganizationStore().$patch({ activeId: 2 })
    await flushPromises()
    expect(viewCalls(get).length).toBe(before + 2)
  })

  it('shows the composer for an active channel and requests archived channels too', async () => {
    const get = mockApi(() => ({ data: [message(1)], meta: { next_cursor: null } }))
    const wrapper = await mountView()
    expect(wrapper.find('textarea[name="body"]').exists()).toBe(true)
    expect(get).toHaveBeenCalledWith('/api/channels', { query: { include_archived: 1 } })
  })

  it('hides the composer in an archived channel', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/channels') {
        return { data: [{ ...channels.data[0], archived_at: '2026-01-01T00:00:00Z' }] } as never
      }
      return { data: [message(1)], meta: { next_cursor: null } } as never
    })
    const wrapper = await mountView()
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.text()).toContain('archived')
  })

  it('subscribes to the channel and appends live messages without duplicates', async () => {
    const realtime = fakeRealtime()
    mockApi(() => ({ data: [message(2), message(1)], meta: { next_cursor: null } }))
    const wrapper = await mountView()
    expect(realtime.client.private).toHaveBeenCalledWith('organizations.1.channels.7')

    realtime.emit('organizations.1.channels.7', message(3))
    realtime.emit('organizations.1.channels.7', message(3))
    realtime.emit('organizations.1.channels.7', message(2))
    realtime.emit('organizations.1.channels.7', { ...message(4), channel_id: 8 })
    await flushPromises()
    expect(wrapper.findAll('li.message').map((li) => li.text())).toEqual([
      expect.stringContaining('body 1'),
      expect.stringContaining('body 2'),
      expect.stringContaining('body 3'),
    ])
  })

  it('keeps a live message that arrives while the history is loading', async () => {
    const realtime = fakeRealtime()
    let resolvePage: (value: unknown) => void = () => {}
    mockApi(() => new Promise((resolve) => (resolvePage = resolve)))
    const wrapper = await mountView()
    realtime.emit('organizations.1.channels.7', message(5))
    resolvePage({ data: [message(4)], meta: { next_cursor: null } })
    await flushPromises()
    expect(wrapper.findAll('li.message')).toHaveLength(2)
  })

  it('leaves the channel on unmount and when the organization changes', async () => {
    const realtime = fakeRealtime()
    mockApi(() => ({ data: [message(1)], meta: { next_cursor: null } }))
    const wrapper = await mountView()

    useOrganizationStore().$patch({ activeId: 2 })
    await flushPromises()
    expect(realtime.client.leave).toHaveBeenCalledWith('organizations.1.channels.7')
    expect(realtime.client.private).toHaveBeenLastCalledWith('organizations.2.channels.7')

    wrapper.unmount()
    expect(realtime.client.leave).toHaveBeenLastCalledWith('organizations.2.channels.7')
  })

  it('catches up missed messages after a reconnection, not on the initial connection', async () => {
    const realtime = fakeRealtime()
    let calls = 0
    const spy = mockApi(() => {
      calls++
      return calls === 1
        ? { data: [message(2), message(1)], meta: { next_cursor: null } }
        : { data: [message(4), message(3), message(2)], meta: { next_cursor: null } }
    })
    const wrapper = await mountView()
    realtime.setStatus('connected')
    await flushPromises()
    expect(viewCalls(spy).filter(([path]) => path !== '/api/channels')).toHaveLength(1)
    expect(toasts.value).toHaveLength(0)

    realtime.setStatus('connecting')
    realtime.setStatus('connected')
    await flushPromises()
    expect(toasts.value.map((item) => [item.kind, item.message])).toEqual([['success', 'Reconnected']])
    expect(viewCalls(spy).filter(([path]) => path !== '/api/channels')).toHaveLength(2)
    expect(wrapper.findAll('li.message').map((li) => li.text())).toEqual([
      expect.stringContaining('body 1'),
      expect.stringContaining('body 2'),
      expect.stringContaining('body 3'),
      expect.stringContaining('body 4'),
    ])
  })

  it('discards a catch-up response that arrives after the organization changed', async () => {
    const realtime = fakeRealtime()
    let calls = 0
    let resolveCatchUp: (value: unknown) => void = () => {}
    mockApi(() => {
      calls++
      if (calls === 2) return new Promise((resolve) => (resolveCatchUp = resolve))
      return { data: [message(1)], meta: { next_cursor: null } }
    })
    const wrapper = await mountView()
    realtime.setStatus('connected')
    realtime.setStatus('failed')
    realtime.setStatus('connected')
    useOrganizationStore().$patch({ activeId: 2 })
    await flushPromises()
    resolveCatchUp({ data: [message(9)], meta: { next_cursor: null } })
    await flushPromises()
    expect(wrapper.findAll('li.message').map((li) => li.text())).toEqual([expect.stringContaining('body 1')])
  })

  it('does not stack a new reconnected toast while one is still visible', async () => {
    const realtime = fakeRealtime()
    mockApi(() => ({ data: [message(1)], meta: { next_cursor: null } }))
    await mountView()
    realtime.setStatus('connected')
    await flushPromises()

    for (let i = 0; i < 2; i++) {
      realtime.setStatus('connecting')
      realtime.setStatus('connected')
      await flushPromises()
    }
    expect(toasts.value.map((item) => item.message)).toEqual(['Reconnected'])

    expect(toasts.value[0].open).toBe(true)
    toast.dismiss(toasts.value[0].id)
    realtime.setStatus('connecting')
    realtime.setStatus('connected')
    await flushPromises()
    expect(toasts.value.filter((item) => item.open).map((item) => item.message)).toEqual(['Reconnected'])
  })

  it('stops listening for reconnections on unmount', async () => {
    const realtime = fakeRealtime()
    mockApi(() => ({ data: [message(1)], meta: { next_cursor: null } }))
    const wrapper = await mountView()
    expect(realtime.statusListeners.size).toBe(1)
    wrapper.unmount()
    expect(realtime.statusListeners.size).toBe(0)
  })

  it('disconnects realtime on logout', async () => {
    const realtime = fakeRealtime()
    mockApi(() => ({ data: [message(1)], meta: { next_cursor: null } }))
    await mountView()
    useAuthStore().clearSession()
    expect(realtime.client.disconnect).toHaveBeenCalledOnce()
  })
})

describe('ChannelView group panel', () => {
  const opened = (id: number, groupId: number): Message => ({
    ...message(id, 'system'),
    payload: { type: 'log.group_opened', log_group_id: groupId, level: 'error', title: `Group ${groupId}`, events_count: 2 },
  })
  const changed = (id: number, groupId: number): Message => ({
    ...message(id, 'system'),
    payload: { type: 'log.group_status_changed', log_group_id: groupId, status: 'resolved', previous_status: 'open' },
  })
  const detail = (id: number) => ({
    data: {
      id,
      project_id: 1,
      level: 'error',
      title: `Group ${id}`,
      status: 'open',
      events_count: 2,
      first_seen_at: '2026-10-01T10:00:00Z',
      last_seen_at: '2026-10-02T10:00:00Z',
      events: [],
    },
  })

  function mockGroups(messages: Message[]) {
    return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/channels') return channels as never
      if (path === '/api/projects') return { data: [], meta: { last_page: 1 } } as never
      const group = /log-groups\/(\d+)$/.exec(path)
      if (group) return detail(Number(group[1])) as never
      return { data: messages, meta: { next_cursor: null } } as never
    })
  }
  const groupCalls = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter(([path]) => String(path).includes('/log-groups/'))

  beforeEach(() => {
    vi.restoreAllMocks()
    setRealtimeClientFactory(() => null)
  })

  it('opens the panel from ?group= and closes it by removing the param', async () => {
    mockGroups([opened(1, 5)])
    const wrapper = await mountView('/channels/7?group=5')
    expect(wrapper.find('aside h2').text()).toBe('Group 5')
    await wrapper.find('button[name="close-group"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('aside').exists()).toBe(false)
    expect(wrapper.router.currentRoute.value.query.group).toBeUndefined()
  })

  it('opens the panel when the notice title is clicked', async () => {
    const spy = mockGroups([opened(1, 5)])
    const wrapper = await mountView()
    expect(wrapper.find('aside').exists()).toBe(false)
    await wrapper.find('.system-notice__title a').trigger('click')
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query.group).toBe('5')
    expect(groupCalls(spy)).toHaveLength(1)
    expect(wrapper.find('aside h2').text()).toBe('Group 5')
  })

  it('keeps the same panel element while the channel reloads', async () => {
    let failing = true
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/channels') return channels as never
      if (path === '/api/projects') return { data: [], meta: { last_page: 1 } } as never
      const group = /log-groups\/(\d+)$/.exec(path)
      if (group) return detail(Number(group[1])) as never
      if (failing) throw new ApiError(500, 'Server error')
      return { data: [opened(1, 5)], meta: { next_cursor: null } } as never
    })
    const wrapper = await mountView('/channels/7?group=5')
    const aside = wrapper.find('aside').element
    expect(aside).toBeDefined()
    failing = false
    await wrapper.find('button[name="retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('aside').element).toBe(aside)
  })

  describe('closing on context change', () => {
    const twoChannels = {
      data: [
        ...channels.data,
        { id: 8, project_id: 2, name: 'OTHER', archived_at: null, created_at: '', project: { id: 2, name: 'Other', key: 'O' } },
      ],
    }

    it('closes the panel when navigating to another channel and uses the new project afterwards', async () => {
      const spy = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
        if (path === '/api/channels') return twoChannels as never
        if (path === '/api/projects') return { data: [], meta: { last_page: 1 } } as never
        const group = /log-groups\/(\d+)$/.exec(path)
        if (group) return detail(Number(group[1])) as never
        return { data: [], meta: { next_cursor: null } } as never
      })
      const wrapper = await mountView('/channels/7?group=5')
      expect(wrapper.find('aside').exists()).toBe(true)
      await wrapper.router.push('/channels/8')
      await flushPromises()
      expect(wrapper.find('aside').exists()).toBe(false)

      await wrapper.router.push('/channels/8?group=6')
      await flushPromises()
      expect(wrapper.find('aside').exists()).toBe(true)
      expect(spy.mock.calls.some(([path]) => path === '/api/projects/2/log-groups/6')).toBe(true)
    })

    it('closes the panel while the channel reloads after an organization change', async () => {
      let pendingChannels = false
      let release: (value: unknown) => void = () => {}
      vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
        if (path === '/api/channels') {
          if (!pendingChannels) return channels as never
          return (await new Promise<never>((resolve) => (release = resolve as (value: unknown) => void)))
        }
        if (path === '/api/projects') return { data: [], meta: { last_page: 1 } } as never
        const group = /log-groups\/(\d+)$/.exec(path)
        if (group) return detail(Number(group[1])) as never
        return { data: [], meta: { next_cursor: null } } as never
      })
      const wrapper = await mountView('/channels/7?group=5')
      expect(wrapper.find('aside').exists()).toBe(true)
      pendingChannels = true
      useOrganizationStore().$patch({ activeId: 2 })
      await flushPromises()
      expect(wrapper.find('aside').exists()).toBe(false)
      release(channels)
      await flushPromises()
    })
  })

  it('toasts and closes the panel replacing the history entry when the group is not found', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/channels') return channels as never
      if (path === '/api/projects') return { data: [], meta: { last_page: 1 } } as never
      if (/log-groups\/(\d+)$/.test(path)) throw new ApiError(404, 'Not found')
      return { data: [opened(1, 5)], meta: { next_cursor: null } } as never
    })
    toast.clear()
    const wrapper = await mountView('/channels/7?group=99')
    expect(wrapper.router.currentRoute.value.query.group).toBeUndefined()
    expect(wrapper.find('aside').exists()).toBe(false)
    expect(toasts.value.map((item) => item.message)).toEqual(['This log group does not exist or you cannot access it.'])
    wrapper.router.back()
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query.group).toBeUndefined()
  })

  it('ignores an invalid ?group= value', async () => {
    const spy = mockGroups([message(1)])
    const wrapper = await mountView('/channels/7?group=abc')
    expect(wrapper.find('aside').exists()).toBe(false)
    expect(groupCalls(spy)).toHaveLength(0)
  })

  it('reloads the panel when a status change for that group arrives in real time', async () => {
    const realtime = fakeRealtime()
    const spy = mockGroups([opened(1, 5)])
    await mountView('/channels/7?group=5')
    expect(groupCalls(spy)).toHaveLength(1)

    realtime.emit('organizations.1.channels.7', changed(2, 9))
    await flushPromises()
    expect(groupCalls(spy)).toHaveLength(1)

    realtime.emit('organizations.1.channels.7', changed(3, 5))
    await flushPromises()
    expect(groupCalls(spy)).toHaveLength(2)
  })
})
