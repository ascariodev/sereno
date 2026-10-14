import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { api, ApiError } from '../api/client'
import { i18n, setLocale } from '../i18n'
import { disablePush, enablePush, getPushState, PushSubscribeError, type PushState } from '../pwa/push'
import { isDesktop } from '../platform/desktop'
import { autostartEnabled, setAutostart } from '../platform/desktopAutostart'
import { desktopPermissionGranted, requestDesktopPermission } from '../platform/desktopNotifications'
import NotificationPreferencesDialog from './NotificationPreferencesDialog.vue'

vi.mock('../pwa/push', async (importOriginal) => ({
  PushSubscribeError: (await importOriginal<typeof import('../pwa/push')>()).PushSubscribeError,
  getPushState: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}))

vi.mock('../platform/desktop', () => ({ isDesktop: vi.fn() }))
vi.mock('../platform/desktopAutostart', () => ({ autostartEnabled: vi.fn(), setAutostart: vi.fn() }))
vi.mock('../platform/desktopNotifications', () => ({
  desktopPermissionGranted: vi.fn(),
  requestDesktopPermission: vi.fn(),
}))

let wrapper: VueWrapper | undefined

type Channel = Record<'task_assigned' | 'task_comment_mention' | 'task_commented' | 'chat_mention', boolean>
type Response = { data: { email: Channel; push: Channel } }

const ON: Channel = Object.freeze({ task_assigned: true, task_comment_mention: true, task_commented: true, chat_mention: true })
const ALL_ON: Response['data'] = Object.freeze({ email: ON, push: ON })

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

function switchFor(type: string, channel = 'email'): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`input[name=${channel}-${type}]`)!
}

function deviceButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[name=toggle-device]')
}

async function toggle(type: string, channel = 'email') {
  const input = switchFor(type, channel)
  input.checked = !input.checked
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
}

function mockDevice(state: PushState) {
  vi.mocked(getPushState).mockResolvedValue(state)
}

beforeEach(() => {
  vi.resetAllMocks()
  setLocale('en')
  vi.mocked(isDesktop).mockReturnValue(false)
  mockDevice('inactive')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

describe('NotificationPreferencesDialog', () => {
  it('loads on open and shows both channels per type with the server state', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue({ data: { email: { ...ON, task_commented: false }, push: { ...ON, chat_mention: false } } })
    mountDialog()
    await nextTick()
    expect(document.querySelector('[data-test=loading]')).not.toBeNull()
    await settle()
    expect(get).toHaveBeenCalledWith('/api/me/notification-preferences')
    expect(switches().map((input) => [input.name, input.checked])).toEqual([
      ['email-task_assigned', true],
      ['push-task_assigned', true],
      ['email-task_comment_mention', true],
      ['push-task_comment_mention', true],
      ['email-task_commented', false],
      ['push-task_commented', true],
      ['email-chat_mention', true],
      ['push-chat_mention', false],
    ])
    expect(document.body.textContent).toContain('Someone comments on my task')
    expect(switchFor('task_commented', 'push').getAttribute('aria-label')).toBe('Someone comments on my task: Push')
    expect(switchFor('task_commented').getAttribute('aria-label')).toBe('Someone comments on my task: Email')
  })

  it('does not load while closed and loads when it opens', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
    mountDialog(false)
    await settle()
    expect(get).not.toHaveBeenCalled()
    expect(getPushState).not.toHaveBeenCalled()
    await wrapper!.setProps({ open: true })
    await settle()
    expect(get).toHaveBeenCalledTimes(1)
    expect(switches()).toHaveLength(8)
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
    expect(switches()).toHaveLength(8)
  })

  it('saves an email change with a partial PATCH', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
    const patch = vi
      .spyOn(api, 'patch')
      .mockResolvedValue({ data: { email: { ...ON, chat_mention: false }, push: ON } })
    mountDialog()
    await settle()
    await toggle('chat_mention')
    expect(patch).toHaveBeenCalledWith('/api/me/notification-preferences', { email: { chat_mention: false } })
    expect(switchFor('chat_mention').checked).toBe(false)
    expect(switchFor('chat_mention', 'push').checked).toBe(true)
    expect(switchFor('chat_mention').getAttribute('aria-disabled')).toBeNull()
  })

  it('saves a push change sending only the push channel', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
    const patch = vi
      .spyOn(api, 'patch')
      .mockResolvedValue({ data: { email: ON, push: { ...ON, task_assigned: false } } })
    mountDialog()
    await settle()
    await toggle('task_assigned', 'push')
    expect(patch).toHaveBeenCalledWith('/api/me/notification-preferences', { push: { task_assigned: false } })
    expect(switchFor('task_assigned', 'push').checked).toBe(false)
    expect(switchFor('task_assigned').checked).toBe(true)
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
    expect(switchFor('task_assigned', 'push').getAttribute('aria-disabled')).toBeNull()
    await toggle('task_assigned')
    expect(patch).toHaveBeenCalledTimes(1)
    expect(switchFor('task_assigned').checked).toBe(false)
    pending.resolve({ data: { email: { ...ON, task_assigned: false }, push: ON } })
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
    await toggle('chat_mention', 'push')
    first.resolve({ data: { email: { ...ON, task_assigned: false }, push: ON } })
    await settle()
    expect(switchFor('task_assigned').checked).toBe(false)
    expect(switchFor('chat_mention', 'push').checked).toBe(false)
    second.resolve({ data: { email: { ...ON, task_assigned: false }, push: { ...ON, chat_mention: false } } })
    await settle()
    expect(switchFor('chat_mention', 'push').checked).toBe(false)
  })

  it('reverts and shows a linked error when saving fails', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(500, 'boom', {}))
    mountDialog()
    await settle()
    await toggle('task_commented', 'push')
    const input = switchFor('task_commented', 'push')
    expect(input.checked).toBe(true)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const errorId = input.getAttribute('aria-describedby')!
    expect(document.getElementById(errorId)?.textContent).toContain('Could not save the change for "Someone comments on my task" (Push)')
    expect(input.closest('tr')!.nextElementSibling).toBe(document.getElementById(errorId)!.closest('tr'))
    expect(document.getElementById(errorId)!.closest('table')).not.toBeNull()
    expect(switchFor('task_commented').getAttribute('aria-describedby')).toBeNull()
    expect(switchFor('task_assigned', 'push').getAttribute('aria-describedby')).toBeNull()
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
    expect(switches()).toHaveLength(8)
  })

  it('discards a save that resolves after closing and reopening', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
    const pending = deferred<Response>()
    vi.spyOn(api, 'patch').mockReturnValue(pending.promise)
    mountDialog()
    await settle()
    await toggle('task_assigned', 'push')
    await wrapper!.setProps({ open: false })
    await settle()
    get.mockResolvedValue({ data: ALL_ON })
    await wrapper!.setProps({ open: true })
    await settle()
    pending.resolve({ data: { email: ON, push: { ...ON, task_assigned: false } } })
    await settle()
    expect(switchFor('task_assigned', 'push').checked).toBe(true)
    expect(switchFor('task_assigned', 'push').getAttribute('aria-disabled')).toBeNull()
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

  describe('this device', () => {
    function status(): string {
      return document.querySelector('[data-test=device-status]')!.textContent!.trim()
    }

    beforeEach(() => {
      vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
    })

    it.each([
      ['unsupported', 'cannot receive push notifications'],
      ['blocked', 'blocked for Sereno'],
      ['active', 'are on for this device'],
      ['inactive', 'are off for this device'],
    ] as const)('shows the %s state', async (state, text) => {
      mockDevice(state)
      mountDialog()
      await settle()
      expect(status()).toContain(text)
      expect(deviceButton() !== null).toBe(state === 'active' || state === 'inactive')
    })

    it('shows the device state even when the preferences fail to load', async () => {
      vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, 'boom', {}))
      mountDialog()
      await settle()
      expect(document.querySelector('[data-test=load-failed]')).not.toBeNull()
      expect(status()).toContain('are off for this device')
    })

    it('turns push on, disables the button while it runs and flips the control', async () => {
      const pending = deferred<PushState>()
      vi.mocked(enablePush).mockReturnValue(pending.promise)
      mountDialog()
      await settle()
      expect(deviceButton()!.textContent).toContain('Turn on push notifications')
      deviceButton()!.click()
      await settle()
      expect(enablePush).toHaveBeenCalledTimes(1)
      expect(deviceButton()!.disabled).toBe(true)
      expect(deviceButton()!.getAttribute('aria-busy')).toBe('true')
      deviceButton()!.click()
      await settle()
      expect(enablePush).toHaveBeenCalledTimes(1)
      pending.resolve('active')
      await settle()
      expect(deviceButton()!.disabled).toBe(false)
      expect(deviceButton()!.textContent).toContain('Turn off push notifications')
      expect(status()).toContain('are on for this device')
    })

    it('turns push off', async () => {
      mockDevice('active')
      vi.mocked(disablePush).mockResolvedValue('inactive')
      mountDialog()
      await settle()
      deviceButton()!.click()
      await settle()
      expect(disablePush).toHaveBeenCalledTimes(1)
      expect(status()).toContain('are off for this device')
      expect(document.querySelector('[data-test=device-notice]')).toBeNull()
    })

    it('shows a notice when the permission prompt is dismissed', async () => {
      vi.mocked(enablePush).mockResolvedValue('inactive')
      mountDialog()
      await settle()
      deviceButton()!.click()
      await settle()
      expect(document.querySelector('[data-test=device-notice]')!.textContent).toContain('closed the permission prompt')
      expect(deviceButton()!.getAttribute('aria-describedby')).toContain('notification-preferences-device-notice')
      expect(document.querySelector('[data-test=device-error]')).toBeNull()
    })

    it('does not show the dismissed notice on a normal flow', async () => {
      vi.mocked(enablePush).mockResolvedValue('active')
      mountDialog()
      await settle()
      deviceButton()!.click()
      await settle()
      expect(document.querySelector('[data-test=device-notice]')).toBeNull()
      expect(deviceButton()!.getAttribute('aria-describedby')).toBe('notification-preferences-device-status')
    })

    it('clears the dismissed notice when turning push off', async () => {
      vi.mocked(enablePush).mockResolvedValue('inactive')
      mountDialog()
      await settle()
      deviceButton()!.click()
      await settle()
      vi.mocked(enablePush).mockResolvedValue('active')
      deviceButton()!.click()
      await settle()
      expect(document.querySelector('[data-test=device-notice]')).toBeNull()
    })

    it('points to the browser when it cannot create the subscription', async () => {
      vi.mocked(enablePush).mockRejectedValue(new PushSubscribeError(new Error('push service error')))
      mountDialog()
      await settle()
      deviceButton()!.click()
      await settle()
      expect(document.querySelector('[data-test=device-error]')!.textContent).toContain('Your browser could not set up push')
    })

    it('renders the device section under the dialog title with a lower heading level', async () => {
      mountDialog()
      await settle()
      expect(document.querySelector('h2')!.textContent).toContain('Notifications')
      expect(document.querySelector('[data-test=device] h3')!.textContent).toContain('This device')
    })

    it('moves to blocked when the permission is denied', async () => {
      vi.mocked(enablePush).mockResolvedValue('blocked')
      mountDialog()
      await settle()
      deviceButton()!.click()
      await settle()
      expect(status()).toContain('blocked for Sereno')
      expect(deviceButton()).toBeNull()
    })

    it('explains a server without VAPID keys and links the error to the button', async () => {
      vi.mocked(enablePush).mockRejectedValue(new ApiError(503, 'unavailable', {}))
      mountDialog()
      await settle()
      expect(deviceButton()!.getAttribute('aria-describedby')).toBe('notification-preferences-device-status')
      deviceButton()!.click()
      await settle()
      const button = deviceButton()!
      expect(button.disabled).toBe(false)
      expect(button.getAttribute('aria-invalid')).toBe('true')
      const ids = button.getAttribute('aria-describedby')!.split(' ')
      expect(ids).toContain('notification-preferences-device-error')
      expect(document.getElementById('notification-preferences-device-error')?.textContent).toContain('not set up on the server')
      expect(status()).toContain('are off for this device')
    })

    it('shows a generic error when enabling fails', async () => {
      vi.mocked(enablePush).mockRejectedValue(new ApiError(500, 'boom', {}))
      mountDialog()
      await settle()
      deviceButton()!.click()
      await settle()
      expect(document.querySelector('[data-test=device-error]')!.textContent).toContain('Could not turn on')
    })

    it('shows a disabling error and keeps the state when turning off fails', async () => {
      mockDevice('active')
      vi.mocked(disablePush).mockRejectedValue(new Error('network'))
      mountDialog()
      await settle()
      deviceButton()!.click()
      await settle()
      expect(document.querySelector('[data-test=device-error]')!.textContent).toContain('Could not turn off')
      expect(status()).toContain('are on for this device')
    })

    it('clears a previous error when the action runs again', async () => {
      vi.mocked(enablePush).mockRejectedValueOnce(new ApiError(503, 'unavailable', {})).mockResolvedValueOnce('active')
      mountDialog()
      await settle()
      deviceButton()!.click()
      await settle()
      expect(document.querySelector('[data-test=device-error]')).not.toBeNull()
      deviceButton()!.click()
      await settle()
      expect(document.querySelector('[data-test=device-error]')).toBeNull()
      expect(deviceButton()!.getAttribute('aria-describedby')).toBe('notification-preferences-device-status')
    })

    it('ignores the result when the dialog closes with the action in flight', async () => {
      const pending = deferred<PushState>()
      vi.mocked(enablePush).mockReturnValue(pending.promise)
      mountDialog()
      await settle()
      deviceButton()!.click()
      await settle()
      await wrapper!.setProps({ open: false })
      await settle()
      expect(document.querySelector('[data-test=device]')).toBeNull()
      pending.resolve('active')
      await settle()
      expect(document.querySelector('[data-test=device]')).toBeNull()
      await wrapper!.setProps({ open: true })
      await settle()
      expect(status()).toContain('are off for this device')
      expect(deviceButton()!.disabled).toBe(false)
    })

    it('ignores a failure when the dialog closes and reopens with the action in flight', async () => {
      const pending = deferred<PushState>()
      vi.mocked(enablePush).mockReturnValue(pending.promise)
      mountDialog()
      await settle()
      deviceButton()!.click()
      await settle()
      await wrapper!.setProps({ open: false })
      await wrapper!.setProps({ open: true })
      await settle()
      pending.reject(new ApiError(503, 'unavailable', {}))
      await settle()
      expect(document.querySelector('[data-test=device-error]')).toBeNull()
      expect(deviceButton()!.disabled).toBe(false)
    })

    it('does not set state when unmounted with the action in flight', async () => {
      const pending = deferred<PushState>()
      vi.mocked(enablePush).mockReturnValue(pending.promise)
      mountDialog()
      await settle()
      deviceButton()!.click()
      await settle()
      wrapper!.unmount()
      wrapper = undefined
      pending.reject(new ApiError(500, 'boom', {}))
      await settle()
      expect(document.querySelector('[data-test=device]')).toBeNull()
    })

    it('discards a device state that resolves after closing', async () => {
      const pending = deferred<PushState>()
      vi.mocked(getPushState).mockReturnValue(pending.promise)
      mountDialog()
      await settle()
      await wrapper!.setProps({ open: false })
      await settle()
      pending.resolve('active')
      await settle()
      expect(document.querySelector('[data-test=device]')).toBeNull()
    })

    it('shows the Spanish texts', async () => {
      setLocale('es')
      mockDevice('blocked')
      mountDialog()
      await settle()
      expect(document.body.textContent).toContain('Este dispositivo')
      expect(status()).toContain('bloqueadas')
      expect(switchFor('chat_mention', 'push').getAttribute('aria-label')).toBe('Me mencionan en el chat: Push')
    })
  })
})

describe('NotificationPreferencesDialog on the desktop app', () => {
  beforeEach(() => {
    vi.mocked(isDesktop).mockReturnValue(true)
    vi.mocked(desktopPermissionGranted).mockResolvedValue(true)
    vi.mocked(autostartEnabled).mockResolvedValue(false)
    vi.spyOn(api, 'get').mockResolvedValue({ data: ALL_ON })
  })

  function autostartSwitch(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('input[name=autostart]')
  }

  async function flip(next: boolean) {
    const input = autostartSwitch()!
    input.checked = next
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
  }

  function desktopButton(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('button[name=request-desktop-permission]')
  }

  it('shows the granted permission without push texts or buttons', async () => {
    vi.mocked(desktopPermissionGranted).mockResolvedValue(true)
    mountDialog()
    await settle()
    const device = document.querySelector('[data-test=device]')!
    expect(device.textContent).toContain('Alerts from Sereno are allowed')
    expect(device.textContent).not.toMatch(/push/i)
    expect(desktopButton()).toBeNull()
    expect(deviceButton()).toBeNull()
    expect(getPushState).not.toHaveBeenCalled()
  })

  it('shows the missing permission and requests it with the button, then reflects the result', async () => {
    vi.mocked(desktopPermissionGranted).mockResolvedValue(false)
    vi.mocked(requestDesktopPermission).mockResolvedValue(true)
    mountDialog()
    await settle()
    const device = document.querySelector('[data-test=device]')!
    expect(device.textContent).toContain('not allowed')
    expect(device.textContent).not.toMatch(/push/i)
    const button = desktopButton()!
    expect(button.getAttribute('aria-describedby')).toBe(document.querySelector('[data-test=device-status]')!.id)
    button.click()
    await settle()
    expect(requestDesktopPermission).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-test=device]')!.textContent).toContain('are allowed')
    expect(desktopButton()).toBeNull()
  })

  it('marks the permission button busy and disabled while the request is pending', async () => {
    const pending = deferred<boolean>()
    vi.mocked(desktopPermissionGranted).mockResolvedValue(false)
    vi.mocked(requestDesktopPermission).mockReturnValue(pending.promise)
    mountDialog()
    await settle()
    expect(desktopButton()!.getAttribute('aria-busy')).toBeNull()
    desktopButton()!.click()
    await settle()
    expect(desktopButton()!.getAttribute('aria-busy')).toBe('true')
    expect(desktopButton()!.disabled).toBe(true)
    pending.resolve(false)
    await settle()
    expect(desktopButton()!.getAttribute('aria-busy')).toBeNull()
    expect(desktopButton()!.disabled).toBe(false)
  })

  it('keeps the button when the request is denied', async () => {
    vi.mocked(desktopPermissionGranted).mockResolvedValue(false)
    vi.mocked(requestDesktopPermission).mockResolvedValue(false)
    mountDialog()
    await settle()
    desktopButton()!.click()
    await settle()
    expect(document.querySelector('[data-test=device]')!.textContent).toContain('not allowed')
    expect(desktopButton()).not.toBeNull()
    expect(desktopButton()!.disabled).toBe(false)
  })

  it('shows the start with Windows switch off by default, labelled and described by its hint', async () => {
    mountDialog()
    await settle()
    const input = autostartSwitch()!
    expect(input.checked).toBe(false)
    expect(input.closest('label')!.textContent).toContain('Start with Windows')
    expect(input.getAttribute('aria-describedby')).toBe(document.querySelector('[data-test=autostart-hint]')!.id)
    expect(document.querySelector('[data-test=autostart-error]')).toBeNull()
  })

  it('starts on when the system reports it enabled', async () => {
    vi.mocked(autostartEnabled).mockResolvedValue(true)
    mountDialog()
    await settle()
    expect(autostartSwitch()!.checked).toBe(true)
  })

  it('enables and disables autostart', async () => {
    vi.mocked(setAutostart).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    mountDialog()
    await settle()
    await flip(true)
    expect(setAutostart).toHaveBeenLastCalledWith(true)
    expect(autostartSwitch()!.checked).toBe(true)
    await flip(false)
    expect(setAutostart).toHaveBeenLastCalledWith(false)
    expect(autostartSwitch()!.checked).toBe(false)
  })

  it('marks the switch busy while changing and ignores a second change', async () => {
    const pending = deferred<boolean>()
    vi.mocked(setAutostart).mockReturnValue(pending.promise)
    mountDialog()
    await settle()
    await flip(true)
    expect(autostartSwitch()!.getAttribute('aria-busy')).toBe('true')
    expect(autostartSwitch()!.getAttribute('aria-disabled')).toBe('true')
    await flip(false)
    expect(setAutostart).toHaveBeenCalledTimes(1)
    expect(autostartSwitch()!.checked).toBe(true)
    pending.resolve(true)
    await settle()
    expect(autostartSwitch()!.getAttribute('aria-busy')).toBeNull()
  })

  it('reverts and shows an error when the change fails, and clears it on the next try', async () => {
    vi.mocked(setAutostart).mockRejectedValueOnce(new Error('registry')).mockResolvedValueOnce(true)
    mountDialog()
    await settle()
    await flip(true)
    const input = autostartSwitch()!
    expect(input.checked).toBe(false)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const error = document.querySelector('[data-test=autostart-error]')!
    expect(error.textContent).toContain('Could not change')
    expect(input.getAttribute('aria-describedby')).toContain(error.id)
    await flip(true)
    expect(document.querySelector('[data-test=autostart-error]')).toBeNull()
    expect(autostartSwitch()!.checked).toBe(true)
  })

  it('is not offered in the browser', async () => {
    vi.mocked(isDesktop).mockReturnValue(false)
    mockDevice('inactive')
    mountDialog()
    await settle()
    expect(autostartSwitch()).toBeNull()
    expect(autostartEnabled).not.toHaveBeenCalled()
  })
})
