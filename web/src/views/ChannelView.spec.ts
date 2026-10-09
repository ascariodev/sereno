import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import type { Message } from '../api/types'
import LogGroupAside from '../components/LogGroupAside.vue'
import { toast, toasts } from '../components/ui/toast'
import { i18n } from '../i18n'
import { setRealtimeClientFactory } from '../realtime/echo'
import { createAppRouter } from '../router'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { useMessagesStore } from '../stores/messages'
import { useProjectsStore } from '../stores/projects'
import { useThreadStore } from '../stores/thread'
import { createFakeRealtimeClient } from '../test/fakeRealtimeClient'
import ChannelView from './ChannelView.vue'

const message = (id: number, kind: Message['kind'] = 'user'): Message => ({
  id,
  channel_id: 7,
  kind,
  body: kind === 'user' ? `body ${id}` : null,
  payload: null,
  log_group_id: null,
  parent_id: null,
  replies_count: 0,
  recent_participants: [],
  last_reply_at: null,
  mentions: [],
  attachments: [],
  user: kind === 'user' ? { id: 1, name: 'Ana' } : null,
  created_at: '2026-01-01T00:00:00Z',
  edited_at: null,
  deleted_at: null,
})
const channels = {
  data: [{ id: 7, project_id: 1, name: 'DEMO', archived_at: null, created_at: '', project: { id: 1, name: 'Demo', key: 'D' } }],
}

async function mountView(path = '/channels/7', attach = false) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().$patch({ token: 't', user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } })
  useOrganizationStore().$patch({ activeId: 1 })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  const wrapper = mount(ChannelView, { global: { plugins: [pinia, i18n, router] }, attachTo: attach ? document.body : undefined })
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
  const emitEvent = (event: string, data: object) => listeners.get(`organizations.1.channels.7|${event}`)?.(data)
  return { client, emit, emitEvent, setStatus, statusListeners }
}

describe('ChannelView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    toast.clear()
    setRealtimeClientFactory(() => null)
  })

  afterEach(() => useProjectsStore().clear())

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
        : { data: [message(4), message(3), message(2), message(1)], meta: { next_cursor: null } }
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
    spy.mock.calls.filter(([path]) => /log-groups\/\d+$/.test(String(path)))

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

  describe('project counts', () => {
    afterEach(() => vi.useRealTimers())
    const projectCalls = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([path]) => path === '/api/projects').length

    it('refreshes the counts once, after 300 ms, for log notices but not for people messages', async () => {
      const realtime = fakeRealtime()
      const spy = mockGroups([opened(1, 5)])
      await mountView()
      const before = projectCalls(spy)
      vi.useFakeTimers()
      realtime.emit('organizations.1.channels.7', message(2))
      await vi.advanceTimersByTimeAsync(1000)
      expect(projectCalls(spy)).toBe(before)

      realtime.emit('organizations.1.channels.7', opened(3, 6))
      realtime.emit('organizations.1.channels.7', changed(4, 6))
      await vi.advanceTimersByTimeAsync(299)
      expect(projectCalls(spy)).toBe(before)
      await vi.advanceTimersByTimeAsync(1)
      expect(projectCalls(spy)).toBe(before + 1)

      realtime.emit('organizations.1.channels.7', { ...opened(5, 7), payload: { ...opened(5, 7).payload!, type: 'log.group_reopened' } } as Message)
      await vi.advanceTimersByTimeAsync(300)
      expect(projectCalls(spy)).toBe(before + 2)
    })

    it('refreshes the counts after a reconnection, not on the initial connection', async () => {
      const realtime = fakeRealtime()
      const spy = mockGroups([opened(1, 5)])
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

    it('refreshes the counts after a status change from the panel', async () => {
      const spy = mockGroups([opened(1, 5)])
      const wrapper = await mountView('/channels/7?group=5')
      const before = projectCalls(spy)
      vi.useFakeTimers()
      wrapper.findComponent(LogGroupAside).vm.$emit('status', 'resolved')
      await vi.advanceTimersByTimeAsync(300)
      expect(projectCalls(spy)).toBe(before + 1)
    })
  })
})

describe('ChannelView thread panel', () => {
  const root = { ...message(1), replies_count: 1 }
  const reply = (id: number, parent = 1): Message => ({ ...message(id), parent_id: parent, body: `reply ${id}` })
  const repliesPath = /\/api\/channels\/7\/messages\/(\d+)\/replies$/

  function mockThread(replies: Message[] = [reply(2)]) {
    return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/channels') return channels as never
      if (path === '/api/projects') return { data: [], meta: { last_page: 1 } } as never
      if (repliesPath.test(path)) return { data: replies.slice().reverse(), meta: { next_cursor: null } } as never
      if (/log-groups\/\d+$/.test(path)) return { data: { id: 5, project_id: 1, level: 'error', title: 'Group 5', status: 'open', events_count: 1, first_seen_at: '', last_seen_at: '', events: [] } } as never
      return { data: [root], meta: { next_cursor: null } } as never
    })
  }
  const replyCalls = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([path]) => repliesPath.test(String(path)))

  beforeEach(() => {
    vi.restoreAllMocks()
    setRealtimeClientFactory(() => null)
    useThreadStore().clear()
  })

  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('opens the panel from ?thread= and closes it by removing the param, clearing the store', async () => {
    mockThread()
    const wrapper = await mountView('/channels/7?thread=1')
    expect(wrapper.find('aside[aria-label="Thread"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('reply 2')
    expect(useThreadStore().rootId).toBe(1)
    await wrapper.find('button[name="close-thread"]').trigger('click')
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query.thread).toBeUndefined()
    expect(wrapper.find('button[name="close-thread"]').exists()).toBe(false)
    expect(useThreadStore().rootId).toBeNull()
  })

  it('ignores an invalid ?thread= value', async () => {
    const spy = mockThread()
    const wrapper = await mountView('/channels/7?thread=abc')
    expect(wrapper.find('button[name="close-thread"]').exists()).toBe(false)
    expect(replyCalls(spy)).toHaveLength(0)
  })

  it('opening a thread removes ?group and opening a group removes ?thread', async () => {
    mockThread()
    const wrapper = await mountView('/channels/7?group=5')
    expect(wrapper.find('button[name="close-group"]').exists()).toBe(true)
    ;(wrapper.vm as unknown as { openThread: (id: number) => void }).openThread(1)
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query).toEqual({ thread: '1' })
    expect(wrapper.find('button[name="close-group"]').exists()).toBe(false)
    expect(wrapper.find('button[name="close-thread"]').exists()).toBe(true)

    await wrapper.router.push({ query: { thread: '1', group: '5' } })
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query).toEqual({ thread: '1' })
  })

  it('selecting a group while a thread is open drops ?thread', async () => {
    mockThread()
    const wrapper = await mountView('/channels/7?thread=1')
    await wrapper.router.push({ query: { group: '5' } })
    await flushPromises()
    expect(wrapper.find('button[name="close-thread"]').exists()).toBe(false)
    expect(wrapper.find('button[name="close-group"]').exists()).toBe(true)
    expect(useThreadStore().rootId).toBeNull()
  })

  it('uses a URL with both params as a thread and drops the group', async () => {
    const spy = mockThread()
    const wrapper = await mountView('/channels/7?thread=1&group=5')
    expect(wrapper.router.currentRoute.value.query).toEqual({ thread: '1' })
    expect(wrapper.find('button[name="close-group"]').exists()).toBe(false)
    expect(spy.mock.calls.some(([path]) => /log-groups/.test(String(path)))).toBe(false)
  })

  it('clears the thread when the channel changes', async () => {
    mockThread()
    const wrapper = await mountView('/channels/7?thread=1')
    expect(useThreadStore().rootId).toBe(1)
    await wrapper.router.push('/channels/8')
    await flushPromises()
    expect(useThreadStore().rootId).toBeNull()
    expect(wrapper.find('button[name="close-thread"]').exists()).toBe(false)
  })

  it('feeds a live reply to the thread and the channel counter through one subscription', async () => {
    const realtime = fakeRealtime()
    mockThread()
    const wrapper = await mountView('/channels/7?thread=1')
    expect(realtime.client.private).toHaveBeenCalledTimes(1)
    expect(realtime.client.private).toHaveBeenCalledWith('organizations.1.channels.7')
    realtime.emit('organizations.1.channels.7', reply(3))
    realtime.emit('organizations.1.channels.7', reply(3))
    realtime.emit('organizations.1.channels.7', reply(4, 99))
    await flushPromises()
    expect(useThreadStore().replies.map((item) => item.id)).toEqual([2, 3])
    expect(wrapper.text()).toContain('reply 3')
    expect(wrapper.text()).not.toContain('reply 4')
    expect(useMessagesStore().messages.find((item) => item.id === 1)?.replies_count).toBe(2)
    expect(realtime.client.private).toHaveBeenCalledTimes(1)
    expect(realtime.client.leave).not.toHaveBeenCalled()
  })

  it('applies live edits to the channel and to the open thread', async () => {
    const realtime = fakeRealtime()
    mockThread()
    const wrapper = await mountView('/channels/7?thread=1')
    realtime.emitEvent('.message.updated', { message: { ...reply(2), body: 'reply edited', edited_at: '2026-01-02T00:00:00Z' } })
    realtime.emitEvent('.message.updated', { message: { ...root, body: 'root edited', edited_at: '2026-01-02T00:00:00Z' } })
    await flushPromises()
    expect(useThreadStore().replies.find((item) => item.id === 2)?.body).toBe('reply edited')
    expect(useMessagesStore().messages.find((item) => item.id === 1)?.body).toBe('root edited')
    expect(wrapper.text()).toContain('reply edited')
  })

  it('applies a live deleted reply to the thread and the channel counter', async () => {
    const realtime = fakeRealtime()
    mockThread()
    const wrapper = await mountView('/channels/7?thread=1')
    realtime.emitEvent('.message.deleted', {
      id: 2,
      channel_id: 7,
      parent_id: 1,
      deleted_at: '2026-01-02T00:00:00Z',
      root: { id: 1, replies_count: 0, last_reply_at: null },
    })
    await flushPromises()
    expect(useThreadStore().replies).toEqual([])
    expect(wrapper.text()).not.toContain('reply 2')
    expect(useMessagesStore().messages.find((item) => item.id === 1)?.replies_count).toBe(0)
  })

  it('keeps a deleted root with replies as a marker in the open thread', async () => {
    const realtime = fakeRealtime()
    mockThread()
    const wrapper = await mountView('/channels/7?thread=1')
    realtime.emitEvent('.message.deleted', {
      id: 1,
      channel_id: 7,
      parent_id: null,
      deleted_at: '2026-01-02T00:00:00Z',
      root: { id: 1, replies_count: 1, last_reply_at: '2026-01-01T00:00:00Z' },
    })
    await flushPromises()
    expect(useThreadStore().replies.map((item) => item.id)).toEqual([2])
    expect(useMessagesStore().messages.find((item) => item.id === 1)?.deleted_at).toBe('2026-01-02T00:00:00Z')
    expect(wrapper.find('[data-test="thread-root"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('reply 2')
  })

  it('catches up both the channel and the thread after a reconnection', async () => {
    const realtime = fakeRealtime()
    const spy = mockThread()
    await mountView('/channels/7?thread=1')
    realtime.setStatus('connected')
    await flushPromises()
    const repliesBefore = replyCalls(spy).length
    const listBefore = viewCalls(spy).filter(([path]) => path === '/api/channels/7/messages').length
    realtime.setStatus('connecting')
    realtime.setStatus('connected')
    await flushPromises()
    expect(replyCalls(spy).length).toBe(repliesBefore + 1)
    expect(viewCalls(spy).filter(([path]) => path === '/api/channels/7/messages')).toHaveLength(listBefore + 1)
  })

  it('shows the thread as a bottom sheet on narrow viewports and closes it from the dialog', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    mockThread()
    const wrapper = await mountView('/channels/7?thread=1')
    const sheet = document.querySelector('[role="dialog"]')
    expect(sheet).not.toBeNull()
    expect(sheet?.querySelector('aside')).not.toBeNull()
    expect(sheet?.textContent).toContain('reply 2')
    ;(sheet?.querySelector('button[name="close-thread"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(wrapper.router.currentRoute.value.query.thread).toBeUndefined()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    wrapper.unmount()
  })

  it('clears the thread store when the view unmounts', async () => {
    mockThread()
    const wrapper = await mountView('/channels/7?thread=1')
    expect(useThreadStore().rootId).toBe(1)
    wrapper.unmount()
    expect(useThreadStore().rootId).toBeNull()
  })

  it('removes the matchMedia listener on unmount', async () => {
    const query = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    window.matchMedia = vi.fn().mockReturnValue(query)
    mockThread()
    const wrapper = await mountView('/channels/7?thread=1')
    expect(query.addEventListener).toHaveBeenCalledTimes(1)
    expect(query.removeEventListener).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(query.removeEventListener).toHaveBeenCalledTimes(1)
    expect(query.removeEventListener).toHaveBeenCalledWith('change', query.addEventListener.mock.calls[0][1])
  })

  // The sheet (narrow) and the inline aside (wide) are different instances; the draft lives in the thread store.
  it('remounts the thread panel and keeps the draft when the viewport goes from narrow to wide', async () => {
    const query = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    window.matchMedia = vi.fn().mockReturnValue(query)
    mockThread()
    const wrapper = await mountView('/channels/7?thread=1')
    const sheet = document.querySelector('[role="dialog"]')
    expect(sheet).not.toBeNull()
    const sheetField = sheet?.querySelector('textarea') as HTMLTextAreaElement
    sheetField.value = 'draft reply'
    sheetField.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(sheetField.value).toBe('draft reply')

    const change = query.addEventListener.mock.calls[0][1] as (event: { matches: boolean }) => void
    change({ matches: false })
    await flushPromises()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    const aside = wrapper.find('aside[aria-label="Thread"]')
    expect(aside.exists()).toBe(true)
    expect(aside.text()).toContain('reply 2')
    expect((aside.find('textarea').element as HTMLTextAreaElement).value).toBe('draft reply')
    expect(useThreadStore().rootId).toBe(1)
    wrapper.unmount()
  })
})

describe('ChannelView delete confirmation', () => {
  const root = { ...message(1), replies_count: 2, last_reply_at: '2026-01-01T05:00:00Z' }
  const reply = { ...message(2), parent_id: 1, body: 'reply 2' }
  const key = (el: Element, name: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
  const settle = async () => {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await flushPromises()
  }
  const dialog = () => document.querySelector('[role=dialog]')
  const confirmButton = () => document.querySelector<HTMLButtonElement>('[data-test=delete-confirm]')!

  async function openDelete(wrapper: Awaited<ReturnType<typeof mountView>>, index = 0) {
    const trigger = wrapper.findAll('.message-item__actions-trigger')[index].element as HTMLButtonElement
    trigger.focus()
    key(trigger, 'ArrowDown')
    await settle()
    key(document.activeElement!, 'ArrowDown')
    key(document.activeElement!, 'Enter')
    await settle()
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    toast.clear()
    i18n.global.locale.value = 'en'
    setRealtimeClientFactory(() => null)
    mockApi(() => ({ data: [root], meta: { next_cursor: null } }))
  })

  afterEach(() => {
    document.body.innerHTML = ''
    useProjectsStore().clear()
  })

  it('opens a confirmation, cancel closes it without calling the API', async () => {
    const del = vi.spyOn(api, 'delete')
    const wrapper = await mountView('/channels/7', true)
    expect(dialog()).toBeNull()
    await openDelete(wrapper)
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain('cannot be undone')
    document.querySelector<HTMLButtonElement>('[data-test=delete-cancel]')!.click()
    await settle()
    expect(dialog()).toBeNull()
    expect(del).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('deletes a root with replies, applies the response without waiting for the event and ignores the duplicate event', async () => {
    const realtime = fakeRealtime()
    const del = vi.spyOn(api, 'delete').mockResolvedValue({ data: { ...root, body: null, deleted_at: '2026-01-02T00:00:00Z' } } as never)
    const wrapper = await mountView('/channels/7', true)
    await openDelete(wrapper)
    confirmButton().click()
    confirmButton().click()
    await settle()
    expect(del).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith('/api/channels/7/messages/1')
    expect(dialog()).toBeNull()
    const stored = () => useMessagesStore().messages.find((item) => item.id === 1)
    expect(stored()?.deleted_at).toBe('2026-01-02T00:00:00Z')
    expect(stored()?.replies_count).toBe(2)
    expect(wrapper.find('[data-test="deleted"]').exists()).toBe(true)
    realtime.emitEvent('.message.deleted', {
      id: 1,
      channel_id: 7,
      parent_id: null,
      deleted_at: '2026-01-02T00:00:00Z',
      root: { id: 1, replies_count: 2, last_reply_at: '2026-01-01T05:00:00Z' },
    })
    await settle()
    expect(useMessagesStore().messages).toHaveLength(1)
    expect(stored()?.replies_count).toBe(2)
    wrapper.unmount()
  })

  it('removes a root without replies from the list', async () => {
    vi.spyOn(api, 'delete').mockResolvedValue({
      data: { ...message(1), replies_count: 0, body: null, deleted_at: '2026-01-02T00:00:00Z' },
    } as never)
    mockApi(() => ({ data: [message(1)], meta: { next_cursor: null } }))
    const wrapper = await mountView('/channels/7', true)
    await openDelete(wrapper)
    confirmButton().click()
    await settle()
    expect(useMessagesStore().messages).toEqual([])
    wrapper.unmount()
  })

  it('applies meta.root to both stores when deleting a reply from the open thread', async () => {
    const replies = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/channels') return channels as never
      if (path === '/api/projects') return { data: [], meta: { last_page: 1 } } as never
      if (/replies$/.test(path)) return { data: [reply], meta: { next_cursor: null } } as never
      return { data: [{ ...root, replies_count: 1 }], meta: { next_cursor: null } } as never
    })
    vi.spyOn(api, 'delete').mockResolvedValue({
      data: { ...reply, body: null, deleted_at: '2026-01-02T00:00:00Z' },
      meta: { root: { id: 1, replies_count: 0, last_reply_at: null } },
    } as never)
    const wrapper = await mountView('/channels/7?thread=1', true)
    expect(replies).toHaveBeenCalled()
    const actions = wrapper.findAll('.message-item__actions-trigger')
    await openDelete(wrapper, actions.length - 1)
    confirmButton().click()
    await settle()
    expect(useThreadStore().replies).toEqual([])
    expect(useMessagesStore().messages.find((item) => item.id === 1)?.replies_count).toBe(0)
    wrapper.unmount()
  })

  it.each([
    [403, 'cannot delete this message'],
    [404, 'already deleted'],
    [422, 'archived'],
    [429, 'Too many requests'],
    [500, 'Could not delete'],
  ])('shows a translated toast for a %i and closes the dialog', async (status, text) => {
    vi.spyOn(api, 'delete').mockRejectedValue(new ApiError(status, 'x'))
    const wrapper = await mountView('/channels/7', true)
    await openDelete(wrapper)
    confirmButton().click()
    await settle()
    expect(toasts.value.map((item) => item.message).join()).toContain(text)
    expect(dialog()).toBeNull()
    expect(useMessagesStore().messages.find((item) => item.id === 1)?.deleted_at).toBeNull()
    wrapper.unmount()
  })

  it('translates the error toast to Spanish', async () => {
    i18n.global.locale.value = 'es'
    vi.spyOn(api, 'delete').mockRejectedValue(new ApiError(429, 'x'))
    const wrapper = await mountView('/channels/7', true)
    await openDelete(wrapper)
    confirmButton().click()
    await settle()
    expect(toasts.value[0].message).toContain('Demasiadas solicitudes')
    wrapper.unmount()
  })

  it('does not touch the stores if the channel changed while deleting', async () => {
    let resolve!: (value: unknown) => void
    vi.spyOn(api, 'delete').mockReturnValue(new Promise((r) => (resolve = r)) as never)
    const wrapper = await mountView('/channels/7', true)
    await openDelete(wrapper)
    confirmButton().click()
    await settle()
    expect(confirmButton().disabled).toBe(true)
    await wrapper.router.push('/channels/8')
    await settle()
    resolve({ data: { ...root, body: null, deleted_at: '2026-01-02T00:00:00Z' } })
    await settle()
    expect(useMessagesStore().messages.find((item) => item.id === 1)?.deleted_at ?? null).toBeNull()
    expect(toasts.value).toHaveLength(0)
    wrapper.unmount()
  })

  it('closes the dialog when the channel changes', async () => {
    const wrapper = await mountView('/channels/7', true)
    await openDelete(wrapper)
    expect(dialog()).not.toBeNull()
    await wrapper.router.push('/channels/8')
    await settle()
    expect(dialog()).toBeNull()
    wrapper.unmount()
  })

  it('catches up the channel after a 404', async () => {
    vi.spyOn(api, 'delete').mockRejectedValue(new ApiError(404, 'x'))
    const wrapper = await mountView('/channels/7', true)
    const catchUp = vi.spyOn(useMessagesStore(), 'catchUp')
    await openDelete(wrapper)
    confirmButton().click()
    await settle()
    expect(catchUp).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
