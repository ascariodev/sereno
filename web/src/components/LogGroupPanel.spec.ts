import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { api, ApiError } from '../api/client'
import type { LogGroup } from '../api/types'
import { i18n } from '../i18n'
import LogGroupPanel from './LogGroupPanel.vue'
import { toast, toasts } from './ui/toast'

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

type Props = { groupId: number; group: LogGroup | null; loading: boolean; loadError: 'failed' | 'notFound' | null; hourly: number[] | null }

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: { render: () => null } }, { path: '/projects/:projectId/plan', name: 'project-plan', component: { render: () => null } }],
})

function mountPanel(props: Partial<Props> & { canCreateTask?: boolean } = {}) {
  return mount(LogGroupPanel, {
    props: { projectId: 3, groupId: 5, group: group(), loading: false, loadError: null, ...props },
    global: { plugins: [createPinia(), i18n, router] },
  })
}

describe('LogGroupPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    toast.clear()
  })

  it('shows pills, count and the latest event with its context', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('h2').text()).toBe('Timeout in webhook')
    expect(wrapper.find('[data-level="error"]').exists()).toBe(true)
    expect(wrapper.find('[data-status="open"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="events-count"]').text()).toBe('37')
    const event = wrapper.find('[data-test="latest-event"]').text()
    expect(event).toContain('newest boom')
    expect(event).toContain('order_id  88412')
    expect(event).not.toContain('older boom')
  })

  it('shows the sparkline of the last 24 h only when the series is available', async () => {
    const counts = Array.from({ length: 24 }, (_, index) => (index === 23 ? 4 : 0))
    const wrapper = mountPanel({ hourly: counts })
    const activity = wrapper.find('[data-test="group-activity"]')
    expect(activity.text()).toContain('Last 24 h')
    expect(activity.find('[data-level="error"]').exists()).toBe(true)
    expect(activity.find('polyline').exists()).toBe(true)
    await wrapper.setProps({ hourly: null })
    expect(wrapper.find('[data-test="group-activity"]').exists()).toBe(false)
    expect(wrapper.find('h2').exists()).toBe(true)
  })

  it('announces the loading text as a status while loading', async () => {
    const wrapper = mountPanel({ group: null, loading: true })
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    await wrapper.setProps({ group: group(), loading: false })
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('shows a not-found message', () => {
    const wrapper = mountPanel({ group: null, loadError: 'notFound' })
    expect(wrapper.find('[role="alert"]').text()).toContain('does not exist')
  })

  it('keeps the group visible with an alert when a reload fails', () => {
    const wrapper = mountPanel({ loadError: 'failed' })
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('h2').exists()).toBe(true)
  })

  it('never requests the group by itself', async () => {
    const get = vi.spyOn(api, 'get')
    mountPanel()
    await flushPromises()
    expect(get).not.toHaveBeenCalled()
  })

  it('resolves through the shared client and emits the applied status', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: group({ status: 'resolved' }) } as never)
    const wrapper = mountPanel()
    await wrapper.find('button[name="resolve"]').trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/api/projects/3/log-groups/5', { status: 'resolved' })
    expect(wrapper.emitted('status')).toEqual([['resolved']])
    expect(toasts.value.map((item) => [item.kind, item.message])).toEqual([['success', 'Marked as resolved']])
  })

  it('shows a confirmation toast when ignoring', async () => {
    vi.spyOn(api, 'patch').mockResolvedValue({ data: group({ status: 'ignored' }) } as never)
    const wrapper = mountPanel()
    await wrapper.find('button[name="ignore"]').trigger('click')
    await flushPromises()
    expect(toasts.value.map((item) => [item.kind, item.message])).toEqual([['success', 'Marked as ignored']])
  })

  it('shows a forbidden message when the action is rejected', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(403, 'Forbidden'))
    const wrapper = mountPanel()
    await wrapper.find('button[name="ignore"]').trigger('click')
    await flushPromises()
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0]).toMatchObject({ kind: 'error' })
    expect(toasts.value[0].message).toContain('not allowed')
    expect(wrapper.emitted('status')).toBeUndefined()
  })

  it('does not emit a status for a group that is no longer shown', async () => {
    let resolvePatch: (value: unknown) => void = () => {}
    vi.spyOn(api, 'patch').mockImplementation(() => new Promise((resolve) => (resolvePatch = resolve)) as never)
    const wrapper = mountPanel()
    await wrapper.find('button[name="resolve"]').trigger('click')
    await wrapper.setProps({ groupId: 6, group: group({ id: 6 }) })
    resolvePatch({ data: group({ status: 'resolved' }) })
    await flushPromises()
    expect(wrapper.emitted('status')).toBeUndefined()
  })

  it('emits close', async () => {
    const wrapper = mountPanel()
    await wrapper.find('button[name="close-group"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows create task only when allowed and the group has no task; otherwise the link', () => {
    expect(mountPanel().find('button[name=create-task]').exists()).toBe(false)
    expect(mountPanel({ canCreateTask: true }).find('button[name=create-task]').text()).toBe('Create task')
    const linked = mountPanel({ canCreateTask: true, group: group({ task: { id: 4, key: 'P-3', status: 'todo' } }) })
    expect(linked.find('button[name=create-task]').exists()).toBe(false)
    expect(linked.get('[data-test=group-task-link]').text()).toBe('View P-3')
  })
})
