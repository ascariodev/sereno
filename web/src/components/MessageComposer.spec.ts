import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { Message } from '../api/types'
import { i18n } from '../i18n'
import { useMessagesStore } from '../stores/messages'
import MessageComposer from './MessageComposer.vue'

const created: Message = {
  id: 9,
  channel_id: 7,
  kind: 'user',
  body: 'hola',
  payload: null,
  log_group_id: null,
  parent_id: null,
  replies_count: 0,
  last_reply_at: null,
  user: { id: 1, name: 'Ana' },
  created_at: '2026-01-01T00:00:00Z',
}

function mountComposer() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useMessagesStore()
  store.$patch({ channelId: 7 })
  return { wrapper: mount(MessageComposer, { global: { plugins: [pinia, i18n] } }), store }
}

describe('MessageComposer', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('sends with Enter, adds the message to the store and clears the field', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: created } as never)
    const { wrapper, store } = mountComposer()
    await wrapper.find('textarea').setValue('hola')
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/api/channels/7/messages', { body: 'hola' })
    expect(store.messages.map((m) => m.id)).toEqual([9])
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps text typed while the send is pending and clears when unchanged', async () => {
    let resolvePost: (value: unknown) => void = () => {}
    vi.spyOn(api, 'post').mockReturnValue(new Promise((resolve) => (resolvePost = resolve)) as never)
    const { wrapper } = mountComposer()
    const field = () => wrapper.find('textarea').element as HTMLTextAreaElement
    await wrapper.find('textarea').setValue('hola')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('textarea').setValue('hola de nuevo')
    resolvePost({ data: created })
    await flushPromises()
    expect(field().value).toBe('hola de nuevo')

    vi.spyOn(api, 'post').mockResolvedValue({ data: created } as never)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(field().value).toBe('')
  })

  it('does not send with Shift+Enter', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: created } as never)
    const { wrapper } = mountComposer()
    await wrapper.find('textarea').setValue('hola')
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(post).not.toHaveBeenCalled()
  })

  it('shows the 422 error and keeps the text', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid', { body: ['The body field is required.'] }))
    const { wrapper } = mountComposer()
    await wrapper.find('textarea').setValue('hola')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('The body field is required.')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('hola')
  })

  it('shows a rate limit message on 429', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(429, 'Too many'))
    const { wrapper } = mountComposer()
    await wrapper.find('textarea').setValue('hola')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('too fast')
  })

  it('counts characters, not UTF-16 units, against the 4000 limit', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: created } as never)
    const { wrapper } = mountComposer()
    await wrapper.find('textarea').setValue('😀'.repeat(4000))
    expect(wrapper.find('button[name="send"]').attributes('disabled')).toBeUndefined()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    await wrapper.find('textarea').setValue('😀'.repeat(4001))
    expect(wrapper.find('button[name="send"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[role="alert"]').text()).toContain('4000')
  })

  it('blocks messages over 4000 characters', async () => {
    const post = vi.spyOn(api, 'post')
    const { wrapper } = mountComposer()
    await wrapper.find('textarea').setValue('a'.repeat(4001))
    expect(wrapper.find('button[name="send"]').attributes('disabled')).toBeDefined()
    await wrapper.find('form').trigger('submit')
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').text()).toContain('4000')
  })

  it('links each textarea to its own hint by a unique id', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(
      { components: { MessageComposer }, template: '<div><MessageComposer /><MessageComposer /></div>' },
      { global: { plugins: [pinia, i18n] } },
    )
    const ids = wrapper.findAll('textarea').map((el) => el.attributes('aria-describedby')!)
    expect(ids[0]).toBeTruthy()
    expect(ids[0]).not.toBe(ids[1])
    for (const id of ids) expect(wrapper.find(`[id="${id}"]`).exists()).toBe(true)
  })
})
