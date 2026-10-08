import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { LogGroup } from '../api/types'
import { i18n } from '../i18n'
import LogGroupPanel from './LogGroupPanel.vue'

const group = (overrides: Partial<LogGroup> = {}): LogGroup => ({
  id: 5,
  project_id: 3,
  level: 'error',
  title: 'Timeout in webhook',
  status: 'open',
  events_count: 37,
  first_seen_at: '2026-10-01T10:00:00.000000Z',
  last_seen_at: '2026-10-02T10:00:00.000000Z',
  events: [
    { id: 2, level: 'error', message: 'newest boom', context: { order_id: 88412, queue: 'billing' }, occurred_at: '', received_at: '' },
    { id: 1, level: 'error', message: 'older boom', context: null, occurred_at: '', received_at: '' },
  ],
  ...overrides,
})

function mountPanel(props: { groupId?: number; refreshToken?: number } = {}) {
  return mount(LogGroupPanel, { props: { projectId: 3, groupId: 5, ...props }, global: { plugins: [i18n] } })
}

describe('LogGroupPanel', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('loads the group and shows pills, count and the latest event with its context', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: group() } as never)
    const wrapper = mountPanel()
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/api/projects/3/log-groups/5', expect.anything())
    expect(wrapper.find('h2').text()).toBe('Timeout in webhook')
    expect(wrapper.find('[data-level="error"]').exists()).toBe(true)
    expect(wrapper.find('[data-status="open"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="events-count"]').text()).toBe('37')
    const event = wrapper.find('[data-test="latest-event"]').text()
    expect(event).toContain('newest boom')
    expect(event).toContain('order_id  88412')
    expect(event).not.toContain('older boom')
  })

  it('shows a not-found message on 404', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, 'Not found'))
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('does not exist')
  })

  it('discards a stale response when the group changes while loading', async () => {
    const resolvers: Record<string, (value: unknown) => void> = {}
    vi.spyOn(api, 'get').mockImplementation(
      (path: string) => new Promise((resolve) => (resolvers[path] = resolve)) as never,
    )
    const wrapper = mountPanel()
    await wrapper.setProps({ groupId: 6 })
    resolvers['/api/projects/3/log-groups/6']({ data: group({ id: 6, title: 'New one' }) })
    await flushPromises()
    resolvers['/api/projects/3/log-groups/5']({ data: group({ id: 5, title: 'Old one' }) })
    await flushPromises()
    expect(wrapper.find('h2').text()).toBe('New one')
  })

  it('resolves through the shared client and updates the status', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: group() } as never)
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: group({ status: 'resolved' }) } as never)
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.find('button[name="resolve"]').trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/api/projects/3/log-groups/5', { status: 'resolved' })
    expect(wrapper.find('[data-status="resolved"]').exists()).toBe(true)
    expect(wrapper.find('button[name="resolve"]').exists()).toBe(false)
    expect(wrapper.find('button[name="ignore"]').exists()).toBe(true)
  })

  it('shows a forbidden message when the action is rejected', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: group() } as never)
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(403, 'Forbidden'))
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.find('button[name="ignore"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="error-action"]').text()).toContain('not allowed')
    expect(wrapper.find('[data-status="open"]').exists()).toBe(true)
  })

  it('reloads without clearing the group when the refresh token changes', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ data: group() } as never)
      .mockResolvedValueOnce({ data: group({ status: 'resolved' }) } as never)
    const wrapper = mountPanel({ refreshToken: 0 })
    await flushPromises()
    await wrapper.setProps({ refreshToken: 1 })
    expect(wrapper.find('h2').exists()).toBe(true)
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-status="resolved"]').exists()).toBe(true)
  })

  it('emits close', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: group() } as never)
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.find('button[name="close-group"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
