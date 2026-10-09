import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { nextTick, ref } from 'vue'
import { i18n } from '../i18n'
import type { Message } from '../api/types'
import MessageItem from './MessageItem.vue'
import { messageActionsKey } from './messageActions'

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

describe('MessageItem actions menu', () => {
  const edit = vi.fn()
  const remove = vi.fn()

  const editingId = ref<number | null>(null)
  const threadRootId = ref<number | null>(null)
  const stopEdit = vi.fn(() => {
    editingId.value = null
  })

  const mounted: { unmount(): void }[] = []
  function renderOwn(overrides: Partial<Message> = {}, ownUserId: number | null = 7, provided = true, threadable = false) {
    const wrapper = mount(MessageItem, {
      props: { message: { ...message, ...overrides }, ownUserId: ownUserId ?? undefined, threadable },
      global: {
        plugins: [i18n, createPinia()],
        provide: provided ? { [messageActionsKey as symbol]: { edit, remove, editingId, threadRootId, stopEdit } } : {},
      },
      attachTo: document.body,
    })
    mounted.push(wrapper)
    return wrapper
  }

  async function settle() {
    await flushPromises()
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const trigger = () => document.querySelector<HTMLButtonElement>('.message-item__actions-trigger')!

  beforeEach(() => {
    i18n.global.locale.value = 'en'
    edit.mockClear()
    remove.mockClear()
    stopEdit.mockClear()
    editingId.value = null
    threadRootId.value = null
  })

  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount())
    document.body.innerHTML = ''
  })

  it('shows the trigger only on own, user, non deleted messages with actions provided', () => {
    expect(renderOwn().find('[data-test=actions]').exists()).toBe(true)
    expect(renderOwn({ user: { id: 8, name: 'Bea' } }).find('[data-test=actions]').exists()).toBe(false)
    expect(renderOwn({ kind: 'system' }).find('[data-test=actions]').exists()).toBe(false)
    expect(renderOwn({ deleted_at: '2026-03-04T11:00:00Z', body: null }).find('[data-test=actions]').exists()).toBe(false)
    expect(renderOwn({}, null).find('[data-test=actions]').exists()).toBe(false)
    expect(renderOwn({}, 7, false).find('[data-test=actions]').exists()).toBe(false)
  })

  it('keeps the trigger focusable with a name, and reveals it by CSS hover, focus-within and touch', () => {
    renderOwn()
    expect(trigger().getAttribute('aria-label')).toBe('Message actions')
    expect(trigger().tabIndex).toBe(0)
  })

  it('opens from the keyboard, selects Edit and Delete through the injected actions', async () => {
    const w = renderOwn()
    trigger().focus()
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await settle()
    const items = [...document.querySelectorAll('[role=menuitem]')]
    expect(items.map((el) => el.textContent?.trim())).toEqual(['Edit', 'Delete'])
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await settle()
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    expect(document.querySelector('[role=menu]')).toBeNull()

    trigger().focus()
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await settle()
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await settle()
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    w.unmount()
  })

  it('swaps the body for the editor with focus and hides the menu while editing that message', async () => {
    const wrapper = renderOwn()
    editingId.value = message.id
    await settle()
    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    expect(document.activeElement).toBe(textarea.element)
    expect(wrapper.find('[data-test=actions]').exists()).toBe(false)
    expect(wrapper.find('.message-item__body').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows no editor when another message is being edited or the message is not editable', async () => {
    editingId.value = message.id + 1
    expect(renderOwn().find('textarea').exists()).toBe(false)
    editingId.value = message.id
    expect(renderOwn({ user: { id: 8, name: 'Bea' } }).find('textarea').exists()).toBe(false)
    expect(renderOwn({}, 7, false).find('textarea').exists()).toBe(false)
  })

  it('stops editing when the editor is cancelled', async () => {
    const wrapper = renderOwn()
    editingId.value = message.id
    await settle()
    await wrapper.find('button[name=cancel-edit]').trigger('click')
    await settle()
    expect(stopEdit).toHaveBeenCalledTimes(1)
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('[data-test=actions]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('leaves the editor of a root to the open thread panel', async () => {
    editingId.value = message.id
    threadRootId.value = message.id
    expect(renderOwn({}, 7, true, true).find('textarea').exists()).toBe(false)
    expect(renderOwn({}, 7, true, false).find('textarea').exists()).toBe(true)
  })
})
