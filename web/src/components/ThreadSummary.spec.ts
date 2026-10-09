import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../api/types'
import { i18n } from '../i18n'
import MessageItem from './MessageItem.vue'
import MessageList from './MessageList.vue'
import SystemNotice from './SystemNotice.vue'
import ThreadSummary from './ThreadSummary.vue'

const base: Message = {
  id: 5,
  channel_id: 1,
  kind: 'user',
  body: 'Hola',
  payload: null,
  log_group_id: null,
  parent_id: null,
  replies_count: 0,
  last_reply_at: null,
  mentions: [],
  attachments: [],
  user: { id: 7, name: 'Ana' },
  created_at: '2026-03-04T10:30:00Z',
}
const global = { plugins: [i18n] }

describe('ThreadSummary', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('shows the reply action when there are no replies and emits the id', async () => {
    const wrapper = mount(ThreadSummary, { props: { message: base }, global })
    expect(wrapper.text()).toBe('Reply in thread')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('open')).toEqual([[5]])
  })

  it('shows the count and how long ago the last reply was', () => {
    const message = { ...base, replies_count: 2, last_reply_at: '2026-03-04T10:00:00Z' }
    const text = mount(ThreadSummary, { props: { message }, global }).text()
    expect(text).toContain('2 replies')
    expect(text).toContain('Last reply 2 hours ago')
  })

  it('uses the singular for one reply', () => {
    const message = { ...base, replies_count: 1, last_reply_at: '2026-03-04T11:59:50Z' }
    expect(mount(ThreadSummary, { props: { message }, global }).text()).toContain('1 reply')
  })

  it('is hidden unless threadable, and never for replies', () => {
    expect(mount(MessageItem, { props: { message: base }, global }).find('button').exists()).toBe(false)
    expect(mount(MessageItem, { props: { message: base, threadable: true }, global }).find('button').exists()).toBe(true)
    const reply = { ...base, id: 6, parent_id: 5 }
    expect(mount(MessageItem, { props: { message: reply, threadable: true }, global }).find('button').exists()).toBe(false)
  })

  it('appears in the system notice card and bubbles up through the list', async () => {
    const notice: Message = {
      ...base,
      kind: 'system',
      body: null,
      payload: { type: 'log.group_opened', log_group_id: 3, title: 'Boom', level: 'error', events_count: 2 } as Message['payload'],
    }
    const card = mount(SystemNotice, { props: { message: notice, threadable: true }, global })
    expect(card.find('button[name="open-thread"]').exists()).toBe(true)
    const list = mount(MessageList, { props: { messages: [base], hasMore: false, loadingMore: false, threadable: true }, global })
    await list.get('button[name="open-thread"]').trigger('click')
    expect(list.emitted('openThread')).toEqual([[5]])
    const plain = mount(MessageList, { props: { messages: [base], hasMore: false, loadingMore: false }, global })
    expect(plain.find('button[name="open-thread"]').exists()).toBe(false)
  })
})
