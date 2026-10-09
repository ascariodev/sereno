import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { i18n } from '../i18n'
import type { Message } from '../api/types'
import MessageItem from './MessageItem.vue'

const message: Message = {
  id: 1,
  channel_id: 1,
  kind: 'user',
  body: 'Hola',
  payload: null,
  log_group_id: null,
  parent_id: null,
  replies_count: 0,
  recent_participants: [],
  last_reply_at: null,
  mentions: [],
  attachments: [],
  user: { id: 7, name: 'Ana' },
  created_at: '2026-03-04T10:30:00Z',
  edited_at: null,
  deleted_at: null,
}

function render() {
  return mount(MessageItem, { props: { message }, global: { plugins: [i18n] } })
}

describe('MessageItem', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('does not make the time a tab stop', () => {
    const time = render().get('time')
    expect(time.attributes('tabindex')).toBeUndefined()
    expect(time.attributes('datetime')).toBe(message.created_at)
  })

  it('keeps the full date readable for screen readers while hiding the short time', () => {
    const time = render().get('time')
    const full = time.get('.sr-only')
    expect(full.text()).toContain('2026')
    expect(full.attributes('aria-hidden')).toBeUndefined()
    expect(time.get('[aria-hidden=true]').text()).not.toContain('2026')
  })

  it('shows (edited) only when edited, with the edit date in its tooltip', () => {
    expect(render().find('[data-test="edited"]').exists()).toBe(false)
    const w = mount(MessageItem, {
      props: { message: { ...message, edited_at: '2026-03-04T11:00:00Z' } },
      global: { plugins: [i18n] },
    })
    const edited = w.get('[data-test="edited"]')
    expect(edited.get('[aria-hidden=true]').text()).toBe('(edited)')
    expect(edited.get('.sr-only').text()).toContain('Edited')
    expect(edited.get('.sr-only').text()).toContain('2026')
  })

  it('shows the deleted marker without body, attachments or edited label, keeping the thread summary', () => {
    const w = mount(MessageItem, {
      props: {
        threadable: true,
        message: {
          ...message,
          body: null,
          deleted_at: '2026-03-04T12:00:00Z',
          edited_at: '2026-03-04T11:00:00Z',
          replies_count: 2,
          last_reply_at: '2026-03-04T11:30:00Z',
          attachments: [{ id: 5, original_name: 'a.pdf', mime: 'application/pdf', size: 10, created_at: message.created_at, url: 'http://api/a' }],
        },
      },
      global: { plugins: [i18n] },
    })
    expect(w.get('[data-test="deleted"]').text()).toBe('Message deleted')
    expect(w.find('.message-item__body').exists()).toBe(false)
    expect(w.find('[data-test="edited"]').exists()).toBe(false)
    expect(w.text()).not.toContain('a.pdf')
    expect(w.text()).toMatch(/2/)
  })

  it('renders attachments and skips the empty body paragraph', () => {
    const w = mount(MessageItem, {
      props: {
        message: {
          ...message,
          body: null,
          attachments: [{ id: 5, original_name: 'a.pdf', mime: 'application/pdf', size: 10, created_at: message.created_at, url: 'http://api/a' }],
        },
      },
      global: { plugins: [i18n] },
    })
    expect(w.find('.message-item__body').exists()).toBe(false)
    expect(w.text()).toContain('a.pdf')
  })
})
