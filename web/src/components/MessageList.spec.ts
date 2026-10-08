import { nextTick } from 'vue'
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

  describe('scroll', () => {
    const box = { top: 0, client: 400 }
    const ROW_PX = 300
    const at = (id: number, userId = 1): Message => ({ ...message({ id: userId, name: 'U' }), id })

    beforeEach(() => {
      Object.assign(box, { top: 0, client: 400 })
      Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
        configurable: true,
        get: () => box.top,
        set: (value: number) => {
          box.top = value
        },
      })
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
        configurable: true,
        get(this: HTMLElement) {
          return this.querySelectorAll('li').length * ROW_PX
        },
      })
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => box.client })
    })
    afterEach(() => {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTop
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
    })

    const mountList = (messages: Message[], ownUserId?: number) =>
      mount(MessageList, { props: { messages, hasMore: false, loadingMore: false, ownUserId }, global: { plugins: [i18n] } })

    it('starts at the bottom when mounted', () => {
      mountList([at(1), at(2)])
      expect(box.top).toBe(900)
    })

    it('follows a new message from someone else when near the bottom', async () => {
      const wrapper = mountList([at(1), at(2)], 99)
      box.top = 420
      await wrapper.setProps({ messages: [at(1), at(2), at(3)] })
      await nextTick()
      expect(box.top).toBe(1200)
    })

    it('does not follow when the distance to the bottom is 81 px', async () => {
      const wrapper = mountList([at(1), at(2)], 99)
      box.top = 419
      await wrapper.setProps({ messages: [at(1), at(2), at(3)] })
      await nextTick()
      expect(box.top).toBe(419)
    })

    it('re-anchors to the bottom when an image loads late while pinned', async () => {
      const wrapper = mountList([at(1), at(2)], 99)
      box.top = 500
      wrapper.find('li.message').element.dispatchEvent(new Event('load'))
      expect(box.top).toBe(900)
    })

    it('does not re-anchor on a late load after scrolling up', async () => {
      const wrapper = mountList([at(1), at(2)], 99)
      box.top = 100
      await wrapper.trigger('scroll')
      wrapper.find('li.message').element.dispatchEvent(new Event('load'))
      expect(box.top).toBe(100)
    })

    it('does not move when a message from someone else arrives while reading above', async () => {
      const wrapper = mountList([at(1), at(2)], 99)
      box.top = 100
      await wrapper.setProps({ messages: [at(1), at(2), at(3)] })
      await nextTick()
      expect(box.top).toBe(100)
    })

    it('jumps to the bottom for an own message even when reading above', async () => {
      const wrapper = mountList([at(1), at(2)], 7)
      box.top = 100
      await wrapper.setProps({ messages: [at(1), at(2), at(3, 7)] })
      await nextTick()
      expect(box.top).toBe(1200)
    })

    it('keeps the position when older messages are prepended', async () => {
      const wrapper = mountList([at(5), at(6)], 99)
      box.top = 30
      await wrapper.setProps({ messages: [at(3), at(4), at(5), at(6)] })
      await nextTick()
      expect(box.top).toBe(630)
    })

    it('does not treat a replaced first id as pagination', async () => {
      const wrapper = mountList([at(5), at(6)], 99)
      box.top = 30
      await wrapper.setProps({ messages: [at(8), at(9)] })
      await nextTick()
      expect(box.top).toBe(30)
    })
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

    describe('midnight rollover', () => {
      beforeAll(() => {
        process.env.TZ = 'America/Bogota'
      })
      afterAll(() => {
        process.env.TZ = 'UTC'
      })

      it('relabels Today after local midnight in a non-UTC zone', async () => {
        vi.setSystemTime(new Date('2026-03-10T03:00:00Z'))
        const wrapper = mountMessages([at(1, '2026-03-10T03:30:00Z')])
        expect(wrapper.find('.message-list__day').text()).toBe('Today')

        await vi.advanceTimersByTimeAsync(2 * 3600 * 1000 + 1000)
        expect(wrapper.find('.message-list__day').text()).toBe('March 9, 2026')
        wrapper.unmount()
      })

      it('clears the timer on unmount', () => {
        const wrapper = mountMessages([at(1, '2026-03-10T09:12:00Z')])
        expect(vi.getTimerCount()).toBe(1)
        wrapper.unmount()
        expect(vi.getTimerCount()).toBe(0)
      })
    })
  })
})
