import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Message } from '../api/types'
import { i18n } from '../i18n'
import MessageList from './MessageList.vue'

const message = (user: Message['user']): Message => ({
  id: 1,
  channel_id: 7,
  kind: 'user',
  body: 'hello',
  payload: null,
  log_group_id: null,
  user,
  created_at: '2026-01-01T00:00:00Z',
})

const mountList = (user: Message['user']) =>
  mount(MessageList, { props: { messages: [message(user)], hasMore: false, loadingMore: false }, global: { plugins: [i18n] } })

describe('MessageList', () => {
  it('shows the author name', () => {
    expect(mountList({ id: 1, name: 'Ana' }).find('strong').text()).toBe('Ana')
  })

  it('falls back to a placeholder when the user is null', () => {
    const wrapper = mountList(null)
    expect(wrapper.find('strong').text()).toBe('Unknown user')
    expect(wrapper.text()).toContain('hello')
  })
})
