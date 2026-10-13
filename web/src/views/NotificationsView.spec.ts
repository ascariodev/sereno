import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { ApiError } from '../api/client'
import * as notificationsApi from '../api/notifications'
import type { AppNotification, NotificationPage } from '../api/types'
import { i18n } from '../i18n'
import { createAppRouter } from '../router'
import { useNotificationsStore } from '../stores/notifications'
import { useOrganizationStore } from '../stores/organization'
import NotificationsView from './NotificationsView.vue'

const base = (id: number) => ({
  id,
  project_id: 3,
  read_at: null,
  created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
})

const taskData = {
  task_id: 40,
  task_key: 'POS-7',
  task_title: 'Fix login',
  actor_id: 2,
  actor_name: 'Camila',
}

const assigned = (id: number, extra: Partial<AppNotification> = {}) =>
  ({ ...base(id), type: 'task_assigned', data: taskData, ...extra }) as AppNotification

const commentData = { ...taskData, comment_id: 8, comment_excerpt: 'looks good to me' }
const commentMention = (id: number) => ({ ...base(id), type: 'task_comment_mention', data: commentData }) as AppNotification
const commented = (id: number) => ({ ...base(id), type: 'task_commented', data: commentData }) as AppNotification

const chatData = {
  channel_id: 4,
  channel_name: 'general',
  message_id: 101,
  parent_id: null,
  message_excerpt: 'check this please',
  actor_id: 2,
  actor_name: 'Camila',
}
const chat = (id: number, parentId: number | null = null) =>
  ({ ...base(id), type: 'chat_mention', data: { ...chatData, parent_id: parentId } }) as AppNotification

const unknown = (id: number) => ({ ...base(id), type: 'unknown', original_type: 'x', data: {} }) as AppNotification

const page = (data: AppNotification[], unread: number, next: string | null = null): NotificationPage => ({
  data,
  meta: { next_cursor: next, unread_count: unread },
})

async function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useOrganizationStore().$patch({ activeId: 1 })
  const router = createAppRouter(createMemoryHistory())
  const wrapper = mount(NotificationsView, { global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return { wrapper, store: useNotificationsStore() }
}

describe('NotificationsView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(notificationsApi, 'markNotificationsRead').mockResolvedValue(0)
  })

  enableAutoUnmount(afterEach)

  afterEach(() => {
    useNotificationsStore().clear()
  })

  it('shows loading and then the empty state', async () => {
    let resolve!: (p: NotificationPage) => void
    vi.spyOn(notificationsApi, 'listNotifications').mockReturnValue(new Promise((r) => (resolve = r)))
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Loading...')
    resolve(page([], 0))
    await flushPromises()
    expect(wrapper.text()).toContain('You have no notifications yet.')
    expect(wrapper.find('button[name=mark-all-read]').exists()).toBe(false)
  })

  it('shows an error and retries', async () => {
    const list = vi.spyOn(notificationsApi, 'listNotifications').mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { wrapper } = await mountView()
    expect(wrapper.find('[role=alert]').text()).toContain('Could not load your notifications.')
    list.mockResolvedValueOnce(page([assigned(1)], 1))
    await wrapper.find('button[name=retry]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    expect(wrapper.findAll('.notification')).toHaveLength(1)
  })

  it('renders one item per type with its text and deep link', async () => {
    vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(
      page([assigned(5), commentMention(4), commented(3), chat(2), chat(1, 55)], 5),
    )
    const { wrapper } = await mountView()
    const items = wrapper.findAll('a.notification')
    expect(items.map((item) => item.attributes('href'))).toEqual([
      '/projects/3/plan?task=40',
      '/projects/3/plan?task=40',
      '/projects/3/plan?task=40',
      '/channels/4?message=101',
      '/channels/4?thread=55',
    ])
    const titleOf = (index: number) => wrapper.find(`#${items[index].attributes('aria-labelledby')}`).text()
    expect(titleOf(0)).toContain('Camila assigned you POS-7')
    expect(titleOf(0)).toContain('Unread')
    expect(titleOf(1)).toContain('Camila mentioned you in a comment on POS-7')
    expect(titleOf(2)).toContain('Camila commented on POS-7')
    expect(titleOf(3)).toContain('Camila mentioned you in general')
    const bodyOf = (index: number) => wrapper.find(`#${items[index].attributes('aria-describedby')}`).text()
    expect(bodyOf(0)).toBe('Fix login')
    expect(bodyOf(1)).toBe('looks good to me')
    expect(bodyOf(3)).toBe('check this please')
  })

  it('shows an unknown type as a generic item without a link or description', async () => {
    vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([unknown(1)], 1))
    const { wrapper, store } = await mountView()
    const item = wrapper.get('button.notification')
    expect(wrapper.find('a.notification').exists()).toBe(false)
    expect(wrapper.find(`#${item.attributes('aria-labelledby')}`).text()).toContain('New notification')
    expect(item.attributes('aria-describedby')).toBeUndefined()
    await item.trigger('click')
    await flushPromises()
    expect(notificationsApi.markNotificationsRead).toHaveBeenCalledWith({ ids: [1] })
    expect(store.notifications[0].read_at).not.toBeNull()
  })

  it('marks a notification read when its link is opened, also with a middle click once', async () => {
    vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([assigned(2), chat(1, 55)], 2))
    const { wrapper, store } = await mountView()
    await wrapper.findAll('a.notification')[0].trigger('click')
    await flushPromises()
    expect(notificationsApi.markNotificationsRead).toHaveBeenCalledWith({ ids: [2] })
    const second = wrapper.findAll('a.notification')[1]
    await second.trigger('auxclick', { button: 2 })
    expect(notificationsApi.markNotificationsRead).toHaveBeenCalledTimes(1)
    await second.trigger('auxclick', { button: 1 })
    await flushPromises()
    expect(notificationsApi.markNotificationsRead).toHaveBeenCalledWith({ ids: [1] })
    expect(store.notifications.every((row) => row.read_at !== null)).toBe(true)
  })

  it('marks all as read and hides the action at zero', async () => {
    vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([assigned(1), chat(2)], 2))
    const { wrapper } = await mountView()
    await wrapper.find('button[name=mark-all-read]').trigger('click')
    await flushPromises()
    expect(notificationsApi.markNotificationsRead).toHaveBeenCalledWith({ all: true })
    expect(wrapper.find('button[name=mark-all-read]').exists()).toBe(false)
    expect(wrapper.findAll('.notification--unread')).toHaveLength(0)
  })

  it('loads more and offers a retry when that fails', async () => {
    const list = vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValueOnce(page([assigned(2)], 1, 'c1'))
    const { wrapper } = await mountView()
    list.mockRejectedValueOnce(new ApiError(500, 'boom'))
    await wrapper.find('button[name=load-more]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('Could not load more notifications.')
    expect(wrapper.findAll('.notification')).toHaveLength(1)
    expect(wrapper.find('button[name=load-more]').text()).toBe('Retry')
    list.mockResolvedValueOnce(page([assigned(1)], 1))
    await wrapper.find('button[name=load-more]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.notification')).toHaveLength(2)
    expect(wrapper.find('button[name=load-more]').exists()).toBe(false)
  })

  it('shows a task notification without a project as a button, not a link', async () => {
    vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue(page([assigned(1, { project_id: null })], 1))
    const { wrapper } = await mountView()
    expect(wrapper.find('a.notification').exists()).toBe(false)
    expect(wrapper.find('button.notification').exists()).toBe(true)
  })
})
