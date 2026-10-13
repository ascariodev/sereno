import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { api, ApiError } from '../api/client'
import { i18n, setLocale } from '../i18n'
import NotificationPreferencesDialog from './NotificationPreferencesDialog.vue'

let wrapper: VueWrapper | undefined

type Response = { data: { email: Record<'task_assigned' | 'task_comment_mention' | 'task_commented' | 'chat_mention', boolean> } }

const ALL_ON: Response['data'] = Object.freeze({
  email: Object.freeze({ task_assigned: true, task_comment_mention: true, task_commented: true, chat_mention: true }),
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function settle() {
  await flushPromises()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function mountDialog(open = true) {
  wrapper = mount(NotificationPreferencesDialog, {
    props: { open, 'onUpdate:open': (value: boolean) => wrapper?.setProps({ open: value }) },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

function switches(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[role=switch]'))
}

function switchFor(type: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`input[name=email-${type}]`)!
}

async function toggle(type: string) {
  const input = switchFor(type)
  input.checked = !input.checked
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
}

beforeEach(() => {
  vi.restoreAllMocks()
  setLocale('en')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

describe('NotificationPreferencesDialog', () => {
  it('loads on open and shows the four switches with the server state', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue({ data: { email: { ...ALL_ON.email, task_commented: false } } })
    mountDialog()
    await nextTick()
    expect(document.querySelector('[data-test=loading]')).not.toBeNull()
    await settle()
    expect(get).toHaveBeenCalledWith('/api/me/notification-preferences')
    expect(switches().map((input) => [input.name, input.checked])).toEqual([
      ['email-task_assigned', true],
      ['email-task_comment_mention', true],
      ['email-task_commented', false],
      ['email-chat_mention', true],
    ])
    expect(document.body.textContent).toContain('Someone comments on my task')
  })

  it('does not load while closed and loads when it opens', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
    mountDialog(false)
    await settle()
    expect(get).not.toHaveBeenCalled()
    await wrapper!.setProps({ open: true })
    await settle()
    expect(get).toHaveBeenCalledTimes(1)
    expect(switches()).toHaveLength(4)
  })

  it('shows an error with retry when loading fails', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(500, 'boom', {}))
    get.mockResolvedValueOnce({ data: ALL_ON })
    mountDialog()
    await settle()
    expect(document.querySelector('[data-test=load-failed]')).not.toBeNull()
    expect(switches()).toHaveLength(0)
    document.querySelector<HTMLButtonElement>('button[name=retry]')!.click()
    await settle()
    expect(document.querySelector('[data-test=load-failed]')).toBeNull()
    expect(switches()).toHaveLength(4)
  })

  it('saves each change with a partial PATCH', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
    const patch = vi
      .spyOn(api, 'patch')
      .mockResolvedValue({ data: { email: { ...ALL_ON.email, chat_mention: false } } })
    mountDialog()
    await settle()
    await toggle('chat_mention')
    expect(patch).toHaveBeenCalledWith('/api/me/notification-preferences', { email: { chat_mention: false } })
    expect(switchFor('chat_mention').checked).toBe(false)
    expect(switchFor('chat_mention').getAttribute('aria-disabled')).toBeNull()
  })

  it('marks the switch busy during the request and ignores a second change', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
    const pending = deferred<Response>()
    const patch = vi.spyOn(api, 'patch').mockReturnValue(pending.promise)
    mountDialog()
    await settle()
    await toggle('task_assigned')
    expect(switchFor('task_assigned').getAttribute('aria-disabled')).toBe('true')
    expect(switchFor('task_assigned').getAttribute('aria-busy')).toBe('true')
    await toggle('task_assigned')
    expect(patch).toHaveBeenCalledTimes(1)
    expect(switchFor('task_assigned').checked).toBe(false)
    pending.resolve({ data: { email: { ...ALL_ON.email, task_assigned: false } } })
    await settle()
    expect(switchFor('task_assigned').getAttribute('aria-disabled')).toBeNull()
  })

  it('keeps another in-flight change when one response arrives', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
    const first = deferred<Response>()
    const second = deferred<Response>()
    vi.spyOn(api, 'patch').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    mountDialog()
    await settle()
    await toggle('task_assigned')
    await toggle('chat_mention')
    first.resolve({ data: { email: { ...ALL_ON.email, task_assigned: false } } })
    await settle()
    expect(switchFor('task_assigned').checked).toBe(false)
    expect(switchFor('chat_mention').checked).toBe(false)
    second.resolve({ data: { email: { ...ALL_ON.email, task_assigned: false, chat_mention: false } } })
    await settle()
    expect(switchFor('chat_mention').checked).toBe(false)
  })

  it('reverts and shows a linked error when saving fails', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(500, 'boom', {}))
    mountDialog()
    await settle()
    await toggle('task_commented')
    const input = switchFor('task_commented')
    expect(input.checked).toBe(true)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const errorId = input.getAttribute('aria-describedby')!
    expect(document.getElementById(errorId)?.textContent).toContain('Could not save the change')
    expect(switchFor('task_assigned').getAttribute('aria-describedby')).toBeNull()
    expect(input.getAttribute('aria-disabled')).toBeNull()
  })

  it('discards a load that resolves after closing', async () => {
    const pending = deferred<Response>()
    vi.spyOn(api, 'get').mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ data: ALL_ON })
    mountDialog()
    await settle()
    await wrapper!.setProps({ open: false })
    await settle()
    pending.resolve({ data: ALL_ON })
    await settle()
    expect(switches()).toHaveLength(0)
    await wrapper!.setProps({ open: true })
    await settle()
    expect(switches()).toHaveLength(4)
  })

  it('discards a save that resolves after closing and reopening', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
    const pending = deferred<Response>()
    vi.spyOn(api, 'patch').mockReturnValue(pending.promise)
    mountDialog()
    await settle()
    await toggle('task_assigned')
    await wrapper!.setProps({ open: false })
    await settle()
    get.mockResolvedValue({ data: { email: { ...ALL_ON.email, task_assigned: true } } })
    await wrapper!.setProps({ open: true })
    await settle()
    pending.resolve({ data: { email: { ...ALL_ON.email, task_assigned: false } } })
    await settle()
    expect(switchFor('task_assigned').checked).toBe(true)
    expect(switchFor('task_assigned').getAttribute('aria-disabled')).toBeNull()
  })

  it('does not set state when unmounted with a pending save', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
    const pending = deferred<Response>()
    vi.spyOn(api, 'patch').mockReturnValue(pending.promise)
    mountDialog()
    await settle()
    await toggle('task_assigned')
    wrapper!.unmount()
    wrapper = undefined
    pending.reject(new ApiError(500, 'boom', {}))
    await settle()
    expect(document.querySelector('input[role=switch]')).toBeNull()
  })
})
