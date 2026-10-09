import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { Message } from '../api/types'
import { i18n } from '../i18n'
import { useAuthStore } from '../stores/auth'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useMessagesStore } from '../stores/messages'
import { useOrganizationStore } from '../stores/organization'
import type { Member } from '../api/types'
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
  mentions: [],
  attachments: [],
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

  describe('mentions', () => {
    const member = (id: number, name: string): Member => ({
      id,
      name,
      email: `${name.toLowerCase()}@x.test`,
      role: 'member',
      joined_at: null,
    })

    function mountWithMembers(props: Record<string, unknown> = {}) {
      const pinia = createPinia()
      setActivePinia(pinia)
      useMessagesStore().$patch({ channelId: 7 })
      useOrganizationStore().$patch({ activeId: 1 })
      useAuthStore().$patch({ user: { id: 1, name: 'Me' } as never })
      const directory = useMemberDirectoryStore()
      directory.$patch({ members: [member(2, 'Ana'), member(3, 'Andres'), member(1, 'Me')] })
      const wrapper = mount(MessageComposer, { props, global: { plugins: [pinia, i18n] } })
      return { wrapper, textarea: () => wrapper.find('textarea') }
    }

    it('opens the list with combobox attributes and excludes the current user', async () => {
      const { wrapper, textarea } = mountWithMembers()
      expect(textarea().attributes('aria-expanded')).toBe('false')
      await textarea().setValue('hi @An')
      expect(textarea().attributes('aria-expanded')).toBe('true')
      const options = wrapper.findAll('[role="option"]')
      expect(options.map((o) => o.find('.composer-option-name').text())).toEqual(['Ana', 'Andres'])
      expect(options[0].text()).toContain('ana@x.test')
      expect(textarea().attributes('aria-controls')).toBe(wrapper.find('[role="listbox"]').attributes('id'))
      expect(textarea().attributes('aria-activedescendant')).toBe(options[0].attributes('id'))
      expect(options[0].attributes('aria-selected')).toBe('true')
      await textarea().setValue('hi @Me')
      expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
    })

    it('moves the active option with the arrows, wrapping around', async () => {
      const { wrapper, textarea } = mountWithMembers()
      await textarea().setValue('@An')
      await textarea().trigger('keydown', { key: 'ArrowDown' })
      const options = wrapper.findAll('[role="option"]')
      expect(textarea().attributes('aria-activedescendant')).toBe(options[1].attributes('id'))
      await textarea().trigger('keydown', { key: 'ArrowDown' })
      expect(textarea().attributes('aria-activedescendant')).toBe(options[0].attributes('id'))
      await textarea().trigger('keydown', { key: 'ArrowUp' })
      expect(textarea().attributes('aria-activedescendant')).toBe(options[1].attributes('id'))
    })

    it('chooses with Enter without sending, and sends the token when the list is closed', async () => {
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: created } as never)
      const { textarea } = mountWithMembers()
      await textarea().setValue('hi @An')
      await textarea().trigger('keydown', { key: 'Enter' })
      expect(post).not.toHaveBeenCalled()
      expect((textarea().element as HTMLTextAreaElement).value).toBe('hi @Ana ')
      expect(textarea().attributes('aria-expanded')).toBe('false')
      await textarea().trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(post).toHaveBeenCalledWith('/api/channels/7/messages', { body: 'hi <@2> ' })
    })

    it('chooses with Tab and with a click', async () => {
      const { wrapper, textarea } = mountWithMembers()
      await textarea().setValue('@An')
      await textarea().trigger('keydown', { key: 'ArrowDown' })
      await textarea().trigger('keydown', { key: 'Tab' })
      expect((textarea().element as HTMLTextAreaElement).value).toBe('@Andres ')
      await textarea().setValue('@An')
      await wrapper.findAll('[role="option"]')[0].trigger('click')
      expect((textarea().element as HTMLTextAreaElement).value).toBe('@Ana ')
    })

    it('closes with Escape keeping the text, and Enter then sends it', async () => {
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: created } as never)
      const { textarea } = mountWithMembers()
      await textarea().setValue('hi @An')
      expect(textarea().attributes('aria-expanded')).toBe('true')
      await textarea().trigger('keydown', { key: 'Escape' })
      expect(textarea().attributes('aria-expanded')).toBe('false')
      expect((textarea().element as HTMLTextAreaElement).value).toBe('hi @An')
      await textarea().trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(post).toHaveBeenCalledWith('/api/channels/7/messages', { body: 'hi @An' })
    })

    it('inserts @ with the Mention button and opens the list', async () => {
      const { wrapper, textarea } = mountWithMembers()
      await textarea().setValue('hi')
      await wrapper.find('button[name="mention"]').trigger('click')
      await flushPromises()
      expect((textarea().element as HTMLTextAreaElement).value).toBe('hi @')
      expect(textarea().attributes('aria-expanded')).toBe('true')
    })

    it('counts the serialized token against the limit and works with a custom send', async () => {
      const send = vi.fn().mockResolvedValue(undefined)
      const { wrapper, textarea } = mountWithMembers({ send, placeholder: 'Reply' })
      expect(textarea().attributes('aria-label')).toBe('Reply')
      await textarea().setValue('@An')
      await textarea().trigger('keydown', { key: 'Enter' })
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(send).toHaveBeenCalledWith('<@2> ', [])
      await textarea().setValue('a'.repeat(4000))
      expect(wrapper.find('button[name="send"]').attributes('disabled')).toBeUndefined()
    })
  })

  describe('attachments', () => {
    const uploaded = (id: number, name = 'a.txt') => ({
      data: { id, original_name: name, mime: 'text/plain', size: 3, created_at: '2026-01-01T00:00:00Z', url: 'x' },
    })

    function mountWithUploads(props: Record<string, unknown> = {}) {
      const pinia = createPinia()
      setActivePinia(pinia)
      useMessagesStore().$patch({ channelId: 7 })
      const wrapper = mount(MessageComposer, { props, global: { plugins: [pinia, i18n] } })
      return wrapper
    }

    async function pick(wrapper: ReturnType<typeof mountWithUploads>, files: File[]) {
      const input = wrapper.find('input[type="file"]')
      Object.defineProperty(input.element, 'files', { value: files, configurable: true })
      await input.trigger('change')
      await flushPromises()
    }

    const file = (name: string, size = 3) => new File([new Uint8Array(size)], name, { type: 'text/plain' })

    it('has a keyboard reachable attach button and a multiple file input that is cleared after choosing', async () => {
      vi.spyOn(api, 'post').mockResolvedValue(uploaded(1) as never)
      const wrapper = mountWithUploads()
      const attach = wrapper.find('button[name="attach"]')
      expect(attach.attributes('type')).toBe('button')
      expect(attach.attributes('aria-label')).toBe('Attach')
      const input = wrapper.find('input[type="file"]')
      expect(input.attributes('multiple')).toBeDefined()
      const click = vi.spyOn(input.element as HTMLInputElement, 'click')
      await attach.trigger('click')
      expect(click).toHaveBeenCalled()
      const element = input.element as HTMLInputElement
      Object.defineProperty(element, 'files', { value: [file('a.txt')], configurable: true })
      element.value = ''
      await input.trigger('change')
      await flushPromises()
      expect(element.value).toBe('')
      expect(wrapper.find('.composer-file-name').text()).toBe('a.txt')
    })

    it('shows uploading state with a per-file cancel and blocks sending while busy', async () => {
      vi.spyOn(api, 'post').mockReturnValue(new Promise(() => {}) as never)
      const wrapper = mountWithUploads()
      await pick(wrapper, [file('a.txt')])
      expect(wrapper.text()).toContain('Uploading...')
      expect(wrapper.find('button[name="cancel-attachment"]').attributes('aria-label')).toBe('Cancel the upload of a.txt')
      await wrapper.find('textarea').setValue('hola')
      expect(wrapper.find('button[name="send"]').attributes('disabled')).toBeDefined()
      await wrapper.find('button[name="cancel-attachment"]').trigger('click')
      expect(wrapper.find('.composer-file').exists()).toBe(false)
      expect(wrapper.find('button[name="send"]').attributes('disabled')).toBeUndefined()
    })

    it('sends with an empty body when an attachment is ready, then clears the list', async () => {
      const post = vi.spyOn(api, 'post').mockImplementation((url: string) =>
        Promise.resolve(url.endsWith('/attachments') ? uploaded(5) : { data: created }) as never,
      )
      const wrapper = mountWithUploads()
      expect(wrapper.find('button[name="send"]').attributes('disabled')).toBeDefined()
      await pick(wrapper, [file('a.txt')])
      expect(wrapper.find('button[name="send"]').attributes('disabled')).toBeUndefined()
      await wrapper.find('textarea').trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(post).toHaveBeenLastCalledWith('/api/channels/7/messages', { body: '', attachment_ids: [5] })
      expect(wrapper.find('.composer-file').exists()).toBe(false)
    })

    it('keeps text and attachments when the send fails', async () => {
      vi.spyOn(api, 'post').mockImplementation((url: string) =>
        url.endsWith('/attachments') ? (Promise.resolve(uploaded(5)) as never) : (Promise.reject(new ApiError(500, 'boom')) as never),
      )
      const wrapper = mountWithUploads()
      await pick(wrapper, [file('a.txt')])
      await wrapper.find('textarea').setValue('hola')
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('hola')
      expect(wrapper.find('.composer-file').exists()).toBe(true)
      expect(wrapper.find('[role="alert"]').text()).toContain('Could not send')
    })

    it('passes the ids to a custom send', async () => {
      vi.spyOn(api, 'post').mockResolvedValue(uploaded(8) as never)
      const send = vi.fn().mockResolvedValue(undefined)
      const wrapper = mountWithUploads({ send, channelId: 9 })
      await pick(wrapper, [file('a.txt')])
      await wrapper.find('textarea').setValue('hi')
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(api.post).toHaveBeenCalledWith('/api/channels/9/attachments', expect.any(FormData), expect.anything())
      expect(send).toHaveBeenCalledWith('hi', [8])
    })

    it('shows a failed upload with retry and an accessible remove button', async () => {
      const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('net')).mockResolvedValue(uploaded(3) as never)
      const wrapper = mountWithUploads()
      await pick(wrapper, [file('a.txt')])
      const alert = wrapper.find('.composer-file-error')
      expect(alert.text()).toBe('Could not upload the file.')
      const retry = wrapper.find('button[name="retry-attachment"]')
      expect(retry.attributes('aria-describedby')).toBe(alert.attributes('id'))
      expect(retry.attributes('aria-label')).toBe('Retry a.txt')
      expect(wrapper.find('button[name="remove-attachment"]').attributes('aria-label')).toBe('Remove a.txt')
      await retry.trigger('click')
      await flushPromises()
      expect(post).toHaveBeenCalledTimes(2)
      expect(wrapper.find('.composer-file').attributes('data-status')).toBe('ready')
    })

    it('does not offer retry for a non retryable rejection and removes it', async () => {
      const wrapper = mountWithUploads()
      await pick(wrapper, [file('big.bin', 6 * 1024 * 1024)])
      expect(wrapper.find('.composer-file-error').text()).toContain('big.bin')
      expect(wrapper.find('button[name="retry-attachment"]').exists()).toBe(false)
      await wrapper.find('button[name="remove-attachment"]').trigger('click')
      expect(wrapper.find('.composer-file').exists()).toBe(false)
    })

    it('adds pasted and dropped files but leaves pasted text alone', async () => {
      vi.spyOn(api, 'post').mockResolvedValue(uploaded(1) as never)
      const wrapper = mountWithUploads()
      const textarea = wrapper.find('textarea')
      const textPaste = new Event('paste', { cancelable: true }) as Event & { clipboardData: unknown }
      textPaste.clipboardData = { files: [] }
      textarea.element.dispatchEvent(textPaste)
      expect(textPaste.defaultPrevented).toBe(false)
      const filePaste = new Event('paste', { cancelable: true }) as Event & { clipboardData: unknown }
      filePaste.clipboardData = { files: [file('p.png')] }
      textarea.element.dispatchEvent(filePaste)
      await flushPromises()
      expect(filePaste.defaultPrevented).toBe(true)
      const drop = new Event('drop', { cancelable: true, bubbles: true }) as Event & { dataTransfer: unknown }
      drop.dataTransfer = { types: ['Files'], files: [file('d.txt')] }
      wrapper.find('.composer-box').element.dispatchEvent(drop)
      await flushPromises()
      expect(wrapper.findAll('.composer-file-name').map((n) => n.text())).toEqual(['p.png', 'd.txt'])
    })
  })
})
