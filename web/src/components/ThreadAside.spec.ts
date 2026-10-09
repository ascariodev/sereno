import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { Message } from '../api/types'
import { i18n } from '../i18n'
import { useMessagesStore } from '../stores/messages'
import { useThreadStore } from '../stores/thread'
import ThreadAside from './ThreadAside.vue'

function message(id: number, extra: Partial<Message> = {}): Message {
  return {
    id,
    channel_id: 7,
    kind: 'user',
    body: `msg ${id}`,
    payload: null,
    log_group_id: null,
    parent_id: null,
    replies_count: 0,
    last_reply_at: null,
    mentions: [],
    attachments: [],
    user: { id: 1, name: 'Ana' },
    created_at: '2026-01-01T10:00:00Z',
    ...extra,
  }
}

const root = message(10, { replies_count: 2 })
const page = (data: Message[], next: string | null = null) => ({ data, links: {}, meta: { next_cursor: next } })
let wrapper: VueWrapper | undefined

function mountAside(props: Record<string, unknown> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(ThreadAside, {
    props: { channelId: 7, rootId: 10, ...props },
    global: { plugins: [pinia, i18n] },
    attachTo: document.body,
  })
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  vi.spyOn(api, 'get').mockResolvedValue(page([message(12, { parent_id: 10 }), message(11, { parent_id: 10 })]) as never)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('ThreadAside', () => {
  it('opens the thread and shows the root from the props with the replies oldest first', async () => {
    const w = mountAside({ root })
    await flushPromises()
    expect(useThreadStore().rootId).toBe(10)
    expect(w.find('[data-test="thread-root"]').text()).toContain('msg 10')
    const items = w.findAll('.message-item__body').map((el) => el.text())
    expect(items).toEqual(['msg 10', 'msg 11', 'msg 12'])
    expect(w.get('[data-test="thread-count"]').text()).toBe('2 replies')
  })

  it('finds the root in the channel store when the prop is omitted', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useMessagesStore().$patch((state) => {
      state.channelId = 7
      state.messages = [root]
    })
    wrapper = mount(ThreadAside, { props: { channelId: 7, rootId: 10 }, global: { plugins: [pinia, i18n] } })
    await flushPromises()
    expect(wrapper.find('[data-test="thread-root"]').text()).toContain('msg 10')
  })

  it('works without the root and counts the loaded replies', async () => {
    const w = mountAside()
    await flushPromises()
    expect(w.find('[data-test="thread-root"]').exists()).toBe(false)
    expect(w.findAll('.message-item')).toHaveLength(2)
    expect(w.get('[data-test="thread-count"]').text()).toBe('2 replies')
  })

  it('shows the empty text and a singular count', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([]) as never)
    const w = mountAside({ root: message(10, { replies_count: 1 }) })
    await flushPromises()
    expect(w.text()).toContain('No replies yet.')
    expect(w.get('[data-test="thread-count"]').text()).toBe('1 reply')
  })

  it('renders a system root as a notice', async () => {
    const notice = message(10, { kind: 'system', body: null, user: null })
    const w = mountAside({ root: notice })
    await flushPromises()
    expect(w.find('[data-test="thread-root"] .message-item').exists()).toBe(false)
  })

  it('sends a reply through the thread store and clears the composer', async () => {
    const w = mountAside({ root })
    await flushPromises()
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: message(13, { parent_id: 10 }) } as never)
    const textarea = w.get('textarea')
    expect(textarea.attributes('placeholder')).toBe('Reply in thread')
    await textarea.setValue('hola')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/api/channels/7/messages', { body: 'hola', parent_id: 10 })
    expect(useThreadStore().replies.map((reply) => reply.id)).toEqual([11, 12, 13])
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('hides the composer in an archived channel', async () => {
    const w = mountAside({ root, archived: true })
    await flushPromises()
    expect(w.find('textarea').exists()).toBe(false)
    expect(w.text()).toContain('This channel is archived; you cannot reply.')
  })

  it('emits close and labels the button', async () => {
    const w = mountAside({ root })
    await flushPromises()
    const button = w.get('button[name="close-thread"]')
    expect(button.attributes('aria-label')).toBe('Close thread')
    await button.trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('focuses the panel on mount', async () => {
    const w = mountAside({ root })
    await flushPromises()
    expect(document.activeElement).toBe(w.get('aside').element)
    expect(w.get('aside').attributes('aria-label')).toBe('Thread')
  })

  it('shows a not found message on 404 and hides the composer', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, 'x'))
    const w = mountAside()
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toBe('This thread does not exist or you cannot access it.')
    expect(w.find('textarea').exists()).toBe(false)
  })

  it('hides the root when the thread is not found', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, 'x'))
    const w = mountAside({ root })
    await flushPromises()
    expect(w.find('[data-test="thread-root"]').exists()).toBe(false)
    expect(w.find('[data-test="thread-root-unavailable"]').exists()).toBe(false)
  })

  it('refocuses the panel when the root changes unless an editable field has focus', async () => {
    const w = mountAside({ root })
    await flushPromises()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    await w.setProps({ rootId: 20, root: undefined })
    await flushPromises()
    expect(document.activeElement).toBe(w.get('aside').element)
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    await w.setProps({ rootId: 30 })
    await flushPromises()
    expect(document.activeElement).toBe(input)
  })

  it('falls back to the root from the replies API when the channel store lacks it', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      ...page([message(11, { parent_id: 10 })]),
      meta: { next_cursor: null, root: message(10, { body: 'old root', replies_count: 1 }) },
    } as never)
    const w = mountAside()
    await flushPromises()
    expect(w.get('[data-test="thread-root"]').text()).toContain('old root')
    expect(w.find('[data-test="thread-root-unavailable"]').exists()).toBe(false)
    useThreadStore().insert(message(12, { parent_id: 10 }))
    await flushPromises()
    expect(w.get('[data-test="thread-count"]').text()).toBe('2 replies')
  })

  it('prefers the root of the channel store over the one from the replies API', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ...page([]), meta: { next_cursor: null, root: message(10, { body: 'from api' }) } } as never)
    const pinia = createPinia()
    setActivePinia(pinia)
    useMessagesStore().$patch((state) => {
      state.channelId = 7
      state.messages = [message(10, { body: 'from channel', replies_count: 4 })]
    })
    wrapper = mount(ThreadAside, { props: { channelId: 7, rootId: 10 }, global: { plugins: [pinia, i18n] } })
    await flushPromises()
    expect(wrapper.get('[data-test="thread-root"]').text()).toContain('from channel')
    expect(wrapper.get('[data-test="thread-count"]').text()).toBe('4 replies')
  })

  it('shows a discreet note when the root is missing', async () => {
    const w = mountAside()
    await flushPromises()
    const note = w.get('[data-test="thread-root-unavailable"]')
    expect(note.text()).toBe('The original message is not loaded.')
    expect(note.attributes('role')).toBeUndefined()
  })

  it('offers to retry after a failed load', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(500, 'x'))
    const w = mountAside({ root })
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('Could not load the replies.')
    get.mockResolvedValue(page([message(11, { parent_id: 10 })]) as never)
    await w.get('button[name="retry-thread"]').trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(w.findAll('.message-item')).toHaveLength(2)
  })

  it('reopens when the root changes and loads older replies on demand', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(page([message(12, { parent_id: 10 })], 'c1') as never)
    const w = mountAside({ root })
    await flushPromises()
    get.mockResolvedValue(page([message(5, { parent_id: 10 })]) as never)
    await w.get('button[name="load-older"]').trigger('click')
    await flushPromises()
    expect(useThreadStore().replies.map((reply) => reply.id)).toEqual([5, 12])
    await w.setProps({ rootId: 20, root: undefined })
    await flushPromises()
    expect(useThreadStore().rootId).toBe(20)
  })

  it('translates the labels to Spanish', async () => {
    i18n.global.locale.value = 'es'
    const w = mountAside({ root })
    await flushPromises()
    expect(w.get('[data-test="thread-count"]').text()).toBe('2 respuestas')
    expect(w.get('textarea').attributes('placeholder')).toBe('Responder en el hilo')
  })
})
