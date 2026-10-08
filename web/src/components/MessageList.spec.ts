import { mount } from '@vue/test-utils'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('forwards select from a system notice', async () => {
    const notice: Message = {
      ...message(null),
      id: 2,
      kind: 'system',
      body: null,
      payload: { type: 'log.group_opened', log_group_id: 9, level: 'error', title: 'Boom', events_count: 2 },
    }
    const wrapper = mount(MessageList, {
      props: { messages: [notice], hasMore: false, loadingMore: false, projectId: 3 },
      global: { plugins: [i18n] },
    })
    await wrapper.find('li.message--system a').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[9]])
  })

  describe('day separators and time', () => {
    const originalTz = process.env.TZ

    beforeAll(() => {
      process.env.TZ = 'UTC'
    })
    afterAll(() => {
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
    })
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-03-10T15:00:00Z'))
      i18n.global.locale.value = 'en'
    })
    afterEach(() => {
      vi.useRealTimers()
      i18n.global.locale.value = 'en'
    })

    const at = (id: number, createdAt: string): Message => ({ ...message({ id: 1, name: 'Ana' }), id, created_at: createdAt })
    const mountMessages = (messages: Message[]) =>
      mount(MessageList, { props: { messages, hasMore: false, loadingMore: false }, global: { plugins: [i18n] } })

    it('labels today and older days, one separator per day', () => {
      const wrapper = mountMessages([
        at(1, '2026-03-08T09:12:00Z'),
        at(2, '2026-03-08T10:00:00Z'),
        at(3, '2026-03-10T09:12:00Z'),
      ])
      const days = wrapper.findAll('.message-list__day').map((day) => day.text())
      expect(days).toEqual(['March 8, 2026', 'Today'])
      expect(wrapper.findAll('strong')).toHaveLength(3)
    })

    it('uses the i18n locale for the separator', () => {
      i18n.global.locale.value = 'es'
      const wrapper = mountMessages([at(1, '2026-03-08T09:12:00Z'), at(2, '2026-03-10T09:12:00Z')])
      expect(wrapper.findAll('.message-list__day').map((day) => day.text())).toEqual(['8 de marzo de 2026', 'Hoy'])
    })

    it('shows the short time in the browser zone', () => {
      const wrapper = mountMessages([at(1, '2026-03-10T09:12:00Z')])
      const time = wrapper.find('time')
      expect(time.text()).toMatch(/9:12/)
      expect(time.attributes('datetime')).toBe('2026-03-10T09:12:00Z')
    })
  })
})
