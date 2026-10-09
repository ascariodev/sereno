import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { ApiError } from '../api/client'
import * as mentionsApi from '../api/mentions'
import type { Mention, MentionPage } from '../api/types'
import { i18n } from '../i18n'
import { createAppRouter } from '../router'
import { useAuthStore } from '../stores/auth'
import { useMentionsStore } from '../stores/mentions'
import { useOrganizationStore } from '../stores/organization'
import MentionsView from './MentionsView.vue'

const mention = (id: number, extra: Partial<Mention> = {}): Mention => ({
  id,
  read_at: null,
  created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  message: {
    id: id + 100,
    channel_id: 4,
    kind: 'user',
    body: 'check <@9> please',
    payload: null,
    log_group_id: null,
    parent_id: null,
    replies_count: 0,
    recent_participants: [],
    last_reply_at: null,
    user: { id: 2, name: 'Camila' },
    mentions: [{ id: 9, name: 'Ada' }],
    attachments: [],
    created_at: '',
  },
  channel: { id: 4, name: 'general', project_id: 1 },
  parent_id: null,
  ...extra,
})

const page = (data: Mention[], unread: number, next: string | null = null): MentionPage => ({
  data,
  meta: { next_cursor: next, unread_count: unread },
})

async function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useOrganizationStore().$patch({ activeId: 1 })
  useAuthStore().$patch({ user: { id: 9, name: 'Ada', email: 'a@e.com', locale: 'en' } })
  const router = createAppRouter(createMemoryHistory())
  const wrapper = mount(MentionsView, { global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return { wrapper, router, store: useMentionsStore() }
}

describe('MentionsView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(mentionsApi, 'markMentionsRead').mockResolvedValue(0)
  })

  enableAutoUnmount(afterEach)

  afterEach(() => {
    useMentionsStore().clear()
  })

  it('shows loading and then the empty state', async () => {
    let resolve!: (p: MentionPage) => void
    vi.spyOn(mentionsApi, 'listMentions').mockReturnValue(new Promise((r) => (resolve = r)))
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Loading...')
    resolve(page([], 0))
    await flushPromises()
    expect(wrapper.text()).toContain('Nobody has mentioned you yet.')
    expect(wrapper.find('button[name=mark-all-read]').exists()).toBe(false)
  })

  it('shows an error and retries', async () => {
    const list = vi.spyOn(mentionsApi, 'listMentions').mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { wrapper } = await mountView()
    expect(wrapper.find('[role=alert]').text()).toContain('Could not load your mentions.')
    list.mockResolvedValueOnce(page([mention(1)], 1))
    await wrapper.find('button[name=retry]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    expect(wrapper.findAll('a.mention')).toHaveLength(1)
  })

  it('renders each row as a link named by its title, with the body and the mention chip', async () => {
    vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(1)], 1))
    const { wrapper } = await mountView()
    const link = wrapper.find('a.mention')
    const title = wrapper.find(`#${link.attributes('aria-labelledby')}`)
    expect(title.text()).toContain('Camila mentioned you in general')
    expect(title.text()).toContain('Unread')
    expect(wrapper.find(`#${link.attributes('aria-describedby')}`).text()).toContain('check')
    expect(wrapper.find('a.mention').html()).toContain('Ada')
    expect(link.attributes('href')).toBe('/channels/4')
  })

  it('links a reply mention to its thread and marks it read on click', async () => {
    vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(1, { parent_id: 55 })], 1))
    const { wrapper, store } = await mountView()
    const link = wrapper.find('a.mention')
    expect(link.attributes('href')).toBe('/channels/4?thread=55')
    await link.trigger('click')
    await flushPromises()
    expect(mentionsApi.markMentionsRead).toHaveBeenCalledWith({ ids: [1] })
    expect(store.mentions[0].read_at).not.toBeNull()
  })

  it('marks all as read and hides the action at zero', async () => {
    vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(1), mention(2)], 2))
    const { wrapper } = await mountView()
    await wrapper.find('button[name=mark-all-read]').trigger('click')
    await flushPromises()
    expect(mentionsApi.markMentionsRead).toHaveBeenCalledWith({ all: true })
    expect(wrapper.find('button[name=mark-all-read]').exists()).toBe(false)
    expect(wrapper.findAll('.mention--unread')).toHaveLength(0)
  })

  it('loads more and offers a retry when that fails', async () => {
    const list = vi.spyOn(mentionsApi, 'listMentions').mockResolvedValueOnce(page([mention(2)], 1, 'c1'))
    const { wrapper } = await mountView()
    list.mockRejectedValueOnce(new ApiError(500, 'boom'))
    await wrapper.find('button[name=load-more]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('Could not load more mentions.')
    expect(wrapper.findAll('a.mention')).toHaveLength(1)
    expect(wrapper.find('button[name=load-more]').text()).toBe('Retry')
    list.mockResolvedValueOnce(page([mention(1)], 1))
    await wrapper.find('button[name=load-more]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('a.mention')).toHaveLength(2)
    expect(wrapper.find('button[name=load-more]').exists()).toBe(false)
  })

  it('keeps the list and shows a retry when a refresh fails after loading', async () => {
    const list = vi.spyOn(mentionsApi, 'listMentions').mockResolvedValueOnce(page([mention(1)], 1))
    const { wrapper, store } = await mountView()
    list.mockRejectedValueOnce(new ApiError(500, 'boom'))
    await store.refresh()
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('Could not load your mentions.')
    expect(wrapper.findAll('a.mention')).toHaveLength(1)
    list.mockResolvedValueOnce(page([mention(1)], 1))
    await wrapper.find('button[name=retry]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
  })

  it('updates the relative time as the clock advances', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(
        page([mention(1, { created_at: new Date(Date.now() - 12 * 60_000).toISOString() })], 1),
      )
      const { wrapper } = await mountView()
      expect(wrapper.find('time').text()).toContain('12 minutes ago')
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(wrapper.find('time').text()).toContain('17 minutes ago')
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks read on middle click once, and ignores other auxiliary buttons', async () => {
    vi.spyOn(mentionsApi, 'listMentions').mockResolvedValue(page([mention(1)], 1))
    const { wrapper } = await mountView()
    const link = wrapper.find('a.mention')
    await link.trigger('auxclick', { button: 2 })
    expect(mentionsApi.markMentionsRead).not.toHaveBeenCalled()
    await link.trigger('auxclick', { button: 1 })
    await link.trigger('auxclick', { button: 1 })
    await flushPromises()
    expect(mentionsApi.markMentionsRead).toHaveBeenCalledTimes(1)
    expect(mentionsApi.markMentionsRead).toHaveBeenCalledWith({ ids: [1] })
  })
})
