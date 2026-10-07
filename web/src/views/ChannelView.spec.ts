import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import type { Message } from '../api/types'
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

async function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().$patch({ token: 't', user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } })
  useOrganizationStore().$patch({ activeId: 1 })
  const router = createAppRouter(createMemoryHistory())
  await router.push('/channels/7')
  const wrapper = mount(ChannelView, { global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return wrapper
}

function mockApi(messages: (cursor?: unknown) => unknown) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string, options?: { query?: { cursor?: unknown } }) => {
    if (path === '/api/channels') return channels as never
    return (await messages(options?.query?.cursor)) as never
  })
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
    setRealtimeClientFactory(() => null)
  })

  it('shows messages oldest first and a generic notice for system messages', async () => {
    mockApi(() => ({ data: [message(3), message(2, 'system'), message(1)], meta: { next_cursor: null } }))
    const wrapper = await mountView()
    const items = wrapper.findAll('li')
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
    expect(wrapper.findAll('li').map((li) => li.text())).toEqual([
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
    expect(wrapper.findAll('li')).toHaveLength(1)
  })

  it('ignores a stale channel request that fails after the organization changed', async () => {
    let rejectStale: (error: unknown) => void = () => {}
    let channelCalls = 0
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/channels') {
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

  it('reloads when the organization changes', async () => {
    const get = mockApi(() => ({ data: [message(1)], meta: { next_cursor: null } }))
    await mountView()
    const before = get.mock.calls.length
    useOrganizationStore().$patch({ activeId: 2 })
    await flushPromises()
    expect(get.mock.calls.length).toBe(before + 2)
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
    expect(wrapper.findAll('li').map((li) => li.text())).toEqual([
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
    expect(wrapper.findAll('li')).toHaveLength(2)
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
    expect(spy.mock.calls.filter(([path]) => path !== '/api/channels')).toHaveLength(1)

    realtime.setStatus('connecting')
    realtime.setStatus('connected')
    await flushPromises()
    expect(spy.mock.calls.filter(([path]) => path !== '/api/channels')).toHaveLength(2)
    expect(wrapper.findAll('li').map((li) => li.text())).toEqual([
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
    expect(wrapper.findAll('li').map((li) => li.text())).toEqual([expect.stringContaining('body 1')])
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
