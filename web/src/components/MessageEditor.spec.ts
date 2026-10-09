import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { Member, Message } from '../api/types'
import { i18n } from '../i18n'
import { useAuthStore } from '../stores/auth'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useMessagesStore } from '../stores/messages'
import MessageEditor from './MessageEditor.vue'

enableAutoUnmount(afterEach)

const base: Message = {
  id: 9,
  channel_id: 7,
  kind: 'user',
  body: 'hola',
  payload: null,
  log_group_id: null,
  parent_id: null,
  replies_count: 0,
  recent_participants: [],
  last_reply_at: null,
  mentions: [],
  attachments: [],
  user: { id: 1, name: 'Me' },
  created_at: '2026-01-01T00:00:00Z',
  edited_at: null,
  deleted_at: null,
}

const member = (id: number, name: string): Member => ({
  id,
  name,
  email: `${name.toLowerCase()}@x.test`,
  role: 'member',
  joined_at: null,
})

function mountEditor(message: Partial<Message> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const target = { ...base, ...message }
  const messages = useMessagesStore()
  messages.$patch({ channelId: 7, messages: [target] as never })
  useAuthStore().$patch({ user: { id: 1, name: 'Me' } as never })
  useMemberDirectoryStore().$patch({ members: [member(2, 'Ana'), member(3, 'Andres'), member(1, 'Me')] })
  const wrapper = mount(MessageEditor, { props: { message: target }, attachTo: document.body, global: { plugins: [pinia, i18n] } })
  return { wrapper, messages, textarea: () => wrapper.find('textarea') }
}

describe('MessageEditor', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('starts with the message text, focused', () => {
    const { textarea } = mountEditor()
    expect((textarea().element as HTMLTextAreaElement).value).toBe('hola')
    expect(document.activeElement).toBe(textarea().element)
  })

  it('shows mentions as @Name and saves them back as tokens', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: { ...base, body: 'hi <@2>!' } } as never)
    const { textarea } = mountEditor({ body: 'hi <@2>', mentions: [{ id: 2, name: 'Ana' }] })
    expect((textarea().element as HTMLTextAreaElement).value).toBe('hi @Ana')
    await textarea().setValue('hi @Ana!')
    await textarea().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/api/channels/7/messages/9', { body: 'hi <@2>!' })
  })

  it('saves with Enter, replaces the message in the store and emits done', async () => {
    const updated = { ...base, body: 'nuevo', edited_at: '2026-01-01T00:05:00Z' }
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: updated } as never)
    const { wrapper, textarea, messages } = mountEditor()
    await textarea().setValue('nuevo')
    await textarea().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/api/channels/7/messages/9', { body: 'nuevo' })
    expect(messages.messages[0].body).toBe('nuevo')
    expect(wrapper.emitted('done')).toHaveLength(1)
  })

  it('does not save with Shift+Enter', async () => {
    const patch = vi.spyOn(api, 'patch')
    const { wrapper, textarea } = mountEditor()
    await textarea().setValue('nuevo')
    await textarea().trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(patch).not.toHaveBeenCalled()
    expect(wrapper.emitted('done')).toBeUndefined()
  })

  it('cancels with Escape and with the button, without calling the API', async () => {
    const patch = vi.spyOn(api, 'patch')
    const { wrapper, textarea } = mountEditor()
    await textarea().setValue('nuevo')
    await textarea().trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('done')).toHaveLength(1)
    await wrapper.find('button[name="cancel-edit"]').trigger('click')
    expect(wrapper.emitted('done')).toHaveLength(2)
    expect(patch).not.toHaveBeenCalled()
  })

  it('Escape closes the suggestions first and does not cancel', async () => {
    const { wrapper, textarea } = mountEditor()
    await textarea().setValue('hola @An')
    expect(textarea().attributes('aria-expanded')).toBe('true')
    await textarea().trigger('keydown', { key: 'Escape' })
    expect(textarea().attributes('aria-expanded')).toBe('false')
    expect(wrapper.emitted('done')).toBeUndefined()
    await textarea().trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('done')).toHaveLength(1)
  })

  it('chooses a suggestion with Enter without saving', async () => {
    const patch = vi.spyOn(api, 'patch')
    const { textarea } = mountEditor()
    await textarea().setValue('hola @An')
    expect(textarea().attributes('aria-controls')).toBeTruthy()
    await textarea().trigger('keydown', { key: 'Enter' })
    expect(patch).not.toHaveBeenCalled()
    expect((textarea().element as HTMLTextAreaElement).value).toBe('hola @Ana ')
  })

  it('closes without calling the API when nothing changed', async () => {
    const patch = vi.spyOn(api, 'patch')
    const { wrapper, textarea } = mountEditor()
    await textarea().trigger('keydown', { key: 'Enter' })
    expect(patch).not.toHaveBeenCalled()
    expect(wrapper.emitted('done')).toHaveLength(1)
  })

  it('closes without calling the API when a restored mention has the same visible text', async () => {
    const patch = vi.spyOn(api, 'patch')
    const { wrapper, textarea } = mountEditor({ body: 'hi <@2>', mentions: [{ id: 2, name: 'Ana' }] })
    await textarea().setValue('hi ')
    await textarea().setValue('hi @An')
    await textarea().trigger('keydown', { key: 'Enter' })
    await textarea().setValue('hi @Ana')
    await textarea().trigger('keydown', { key: 'Enter' })
    expect(patch).not.toHaveBeenCalled()
    expect(wrapper.emitted('done')).toHaveLength(1)
  })

  it('blocks an empty body unless the message has attachments', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: { ...base, body: null } } as never)
    const { wrapper, textarea } = mountEditor()
    await textarea().setValue('   ')
    expect(wrapper.find('button[name="save-edit"]').attributes('disabled')).toBeDefined()
    await textarea().trigger('keydown', { key: 'Enter' })
    expect(patch).not.toHaveBeenCalled()
    wrapper.unmount()

    const withFile = mountEditor({
      attachments: [{ id: 1, name: 'a.png', mime_type: 'image/png', size: 1, url: 'x' } as never],
    })
    await withFile.textarea().setValue('')
    expect(withFile.wrapper.find('button[name="save-edit"]').attributes('disabled')).toBeUndefined()
    await withFile.textarea().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/api/channels/7/messages/9', { body: '' })
  })

  it('counts characters, not UTF-16 units, against the 4000 limit', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: base } as never)
    const { wrapper, textarea } = mountEditor()
    await textarea().setValue('😀'.repeat(4000))
    expect(wrapper.find('button[name="save-edit"]').attributes('disabled')).toBeUndefined()
    await textarea().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(patch).toHaveBeenCalledTimes(1)
    await textarea().setValue('😀'.repeat(4001))
    expect(wrapper.find('button[name="save-edit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[role="alert"]').text()).toContain('4000')
  })

  it.each([
    [new ApiError(422, 'invalid', { body: ['The body field is required.'] }), 'The body field is required.'],
    [new ApiError(429, 'Too many'), 'too fast'],
    [new ApiError(403, 'no'), 'cannot edit'],
    [new ApiError(404, 'no'), 'no longer exists'],
    [new ApiError(500, 'boom'), 'Could not save'],
  ])('shows the error, keeps the text and links it to the field (%#)', async (error, text) => {
    vi.spyOn(api, 'patch').mockRejectedValue(error)
    const { wrapper, textarea } = mountEditor()
    await textarea().setValue('nuevo')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    const alert = wrapper.find('[role="alert"]')
    expect(alert.text()).toContain(text)
    expect(textarea().attributes('aria-invalid')).toBe('true')
    expect(textarea().attributes('aria-describedby')).toContain(alert.attributes('id')!)
    expect((textarea().element as HTMLTextAreaElement).value).toBe('nuevo')
    expect(wrapper.emitted('done')).toBeUndefined()
  })

  it('does not touch the stores if unmounted while saving', async () => {
    let resolvePatch: (value: unknown) => void = () => {}
    vi.spyOn(api, 'patch').mockReturnValue(new Promise((resolve) => (resolvePatch = resolve)) as never)
    const { wrapper, textarea, messages } = mountEditor()
    const replace = vi.spyOn(messages, 'replace')
    await textarea().setValue('nuevo')
    await textarea().trigger('keydown', { key: 'Enter' })
    wrapper.unmount()
    resolvePatch({ data: { ...base, body: 'nuevo', edited_at: '2026-01-01T00:05:00Z' } })
    await flushPromises()
    expect(replace).not.toHaveBeenCalled()
  })

  it('gives each editor unique ids for the hint', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(
      { components: { MessageEditor }, template: '<div><MessageEditor :message="m" /><MessageEditor :message="m" /></div>', data: () => ({ m: base }) },
      { global: { plugins: [pinia, i18n] } },
    )
    const ids = wrapper.findAll('textarea').map((el) => el.attributes('aria-describedby')!.split(' ')[0])
    expect(ids[0]).not.toBe(ids[1])
    for (const id of ids) expect(wrapper.find(`[id="${id}"]`).exists()).toBe(true)
  })
})
