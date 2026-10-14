import type { ActionPerformed } from '@tauri-apps/plugin-notification'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import type { NotificationPreferences, TaskAssignedNotification } from '../api/types'

const windowState = vi.hoisted(() => ({ visible: true, minimized: false, focused: true }))
const getCurrentWindow = vi.hoisted(() => vi.fn())
const isPermissionGranted = vi.hoisted(() => vi.fn())
const requestPermission = vi.hoisted(() => vi.fn())
const sendNotification = vi.hoisted(() => vi.fn())
const getNotificationPreferences = vi.hoisted(() => vi.fn())
const onAction = vi.hoisted(() => vi.fn())
const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  invoke,
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow }))
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
}))
vi.mock('../api/notificationPreferences', () => ({ getNotificationPreferences }))

const ORGANIZATION = 7

const notification: TaskAssignedNotification = {
  id: 1,
  type: 'task_assigned',
  project_id: 3,
  read_at: null,
  created_at: '2026-10-13T10:00:00.000000Z',
  data: { task_id: 9, task_key: 'WEB-9', task_title: 'Fix the login', actor_id: 2, actor_name: 'Ana' },
}

function preferences(push: boolean): NotificationPreferences {
  const all = { task_assigned: true, task_comment_mention: true, task_commented: true, chat_mention: true }
  return { email: all, push: { ...all, task_assigned: push } }
}

async function load() {
  vi.resetModules()
  return import('./desktopNotifications')
}

describe('notifyDesktop', () => {
  beforeEach(() => {
    vi.stubGlobal('isTauri', true)
    Object.assign(windowState, { visible: false, minimized: false, focused: false })
    getCurrentWindow.mockReset().mockReturnValue({
      isVisible: () => Promise.resolve(windowState.visible),
      isMinimized: () => Promise.resolve(windowState.minimized),
      isFocused: () => Promise.resolve(windowState.focused),
    })
    isPermissionGranted.mockReset().mockResolvedValue(true)
    requestPermission.mockReset().mockResolvedValue('granted')
    sendNotification.mockReset()
    getNotificationPreferences.mockReset().mockResolvedValue(preferences(true))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not show it while the window is visible and focused', async () => {
    Object.assign(windowState, { visible: true, focused: true })
    const { notifyDesktop } = await load()
    await notifyDesktop(notification, ORGANIZATION, () => ORGANIZATION)
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('shows it with the inbox texts while the window is hidden', async () => {
    const { notifyDesktop } = await load()
    const { notificationTitle } = await import('../notificationText')
    await notifyDesktop(notification, ORGANIZATION, () => ORGANIZATION)
    expect(sendNotification).toHaveBeenCalledWith({ title: notificationTitle(notification), body: 'Fix the login' })
  })

  it('shows it while the window is minimized', async () => {
    Object.assign(windowState, { visible: true, minimized: true, focused: true })
    const { notifyDesktop } = await load()
    await notifyDesktop(notification, ORGANIZATION, () => ORGANIZATION)
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('shows it while the window is visible without focus', async () => {
    Object.assign(windowState, { visible: true, focused: false })
    const { notifyDesktop } = await load()
    await notifyDesktop(notification, ORGANIZATION, () => ORGANIZATION)
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('does not show it when the push preference of its type is off', async () => {
    getNotificationPreferences.mockResolvedValue(preferences(false))
    const { notifyDesktop } = await load()
    await notifyDesktop(notification, ORGANIZATION, () => ORGANIZATION)
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('does not show one from another organization', async () => {
    const { notifyDesktop } = await load()
    await notifyDesktop(notification, ORGANIZATION + 1, () => ORGANIZATION)
    expect(getCurrentWindow).not.toHaveBeenCalled()
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('does not show it when the session changes while the preferences are loading', async () => {
    let resolvePreferences!: (value: NotificationPreferences) => void
    getNotificationPreferences.mockReturnValue(new Promise((resolve) => (resolvePreferences = resolve)))
    let active: number | null = ORGANIZATION
    const { notifyDesktop } = await load()
    const pending = notifyDesktop(notification, ORGANIZATION, () => active)
    await vi.waitFor(() => expect(getNotificationPreferences).toHaveBeenCalled())
    active = null
    resolvePreferences(preferences(true))
    await pending
    expect(isPermissionGranted).not.toHaveBeenCalled()
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('does not show it when the session changes while the permission is being resolved', async () => {
    let resolvePermission!: (value: boolean) => void
    isPermissionGranted.mockReturnValue(new Promise((resolve) => (resolvePermission = resolve)))
    let active: number | null = ORGANIZATION
    const { notifyDesktop } = await load()
    const pending = notifyDesktop(notification, ORGANIZATION, () => active)
    await vi.waitFor(() => expect(isPermissionGranted).toHaveBeenCalled())
    active = null
    resolvePermission(true)
    await pending
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('does not ask for the preferences when the session changed while reading the window', async () => {
    let active: number | null = ORGANIZATION
    getCurrentWindow.mockReturnValue({
      isVisible: () => {
        active = null
        return Promise.resolve(false)
      },
      isMinimized: () => Promise.resolve(false),
      isFocused: () => Promise.resolve(false),
    })
    const { notifyDesktop } = await load()
    await notifyDesktop(notification, ORGANIZATION, () => active)
    expect(getNotificationPreferences).not.toHaveBeenCalled()
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('asks for permission once and does not insist after a denial', async () => {
    isPermissionGranted.mockResolvedValue(false)
    requestPermission.mockResolvedValue('denied')
    const { notifyDesktop } = await load()
    await notifyDesktop(notification, ORGANIZATION, () => ORGANIZATION)
    await notifyDesktop({ ...notification, id: 2 }, ORGANIZATION, () => ORGANIZATION)
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('shows it once the first request is granted', async () => {
    isPermissionGranted.mockResolvedValue(false)
    const { notifyDesktop } = await load()
    await notifyDesktop(notification, ORGANIZATION, () => ORGANIZATION)
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('does nothing in a browser', async () => {
    vi.unstubAllGlobals()
    const { notifyDesktop } = await load()
    await notifyDesktop(notification, ORGANIZATION, () => ORGANIZATION)
    expect(getCurrentWindow).not.toHaveBeenCalled()
    expect(getNotificationPreferences).not.toHaveBeenCalled()
    expect(sendNotification).not.toHaveBeenCalled()
  })
})

describe('installDesktopNotificationClicks', () => {
  const PATH = '/projects/3/plan?task=9'
  let router: Router
  let active: number | null

  function tap(extra: Record<string, unknown> | null, actionId = 'tap'): ActionPerformed {
    return {
      actionId,
      inputValue: null,
      notification: extra === null ? null : ({ id: 1, title: 'Ana', extra } as unknown as ActionPerformed['notification']),
    }
  }

  async function install() {
    const module = await load()
    await module.installDesktopNotificationClicks(router, () => active)
    const handler = onAction.mock.calls[0]?.[0] as ((event: ActionPerformed) => void) | undefined
    return { ...module, click: (event: ActionPerformed) => handler?.(event) }
  }

  beforeEach(async () => {
    vi.stubGlobal('isTauri', true)
    active = ORGANIZATION
    getCurrentWindow.mockReset().mockReturnValue({
      isVisible: () => Promise.resolve(false),
      isMinimized: () => Promise.resolve(false),
      isFocused: () => Promise.resolve(false),
    })
    isPermissionGranted.mockReset().mockResolvedValue(true)
    sendNotification.mockReset()
    getNotificationPreferences.mockReset().mockResolvedValue(preferences(true))
    onAction.mockReset().mockResolvedValue({ unregister: vi.fn() })
    invoke.mockReset().mockResolvedValue(undefined)
    const view = { template: '<div />' }
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'projects', component: view },
        { path: '/channels/:id', name: 'channel', component: view },
        { path: '/projects/:projectId/plan', name: 'project-plan', component: view },
      ],
    })
    await router.push('/')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the destination of the notification with its organization', async () => {
    const { notifyDesktop } = await install()
    await notifyDesktop(notification, ORGANIZATION, () => ORGANIZATION)
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ extra: { organizationId: ORGANIZATION, path: PATH } }),
    )
  })

  it('brings the window back and opens the destination on a click', async () => {
    const { click } = await install()
    click(tap({ organizationId: ORGANIZATION, path: PATH }))
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(PATH))
    expect(invoke).toHaveBeenCalledWith('focus_main_window')
  })

  it('only brings the window back when the organization is no longer the active one', async () => {
    const { click } = await install()
    active = ORGANIZATION + 1
    click(tap({ organizationId: ORGANIZATION, path: PATH }))
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('focus_main_window'))
    await new Promise((resolve) => setTimeout(resolve))
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it.each(['https://evil.example/projects', '//evil.example', '/login', 42])(
    'does not navigate to a destination that is not a local route (%s)',
    async (path) => {
      const push = vi.spyOn(router, 'push')
      const { click } = await install()
      click(tap({ organizationId: ORGANIZATION, path }))
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('focus_main_window'))
      await new Promise((resolve) => setTimeout(resolve))
      expect(push).not.toHaveBeenCalled()
    },
  )

  it('only brings the window back for a notification without a destination', async () => {
    const push = vi.spyOn(router, 'push')
    const { click } = await install()
    click(tap(null))
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('focus_main_window'))
    await new Promise((resolve) => setTimeout(resolve))
    expect(push).not.toHaveBeenCalled()
  })

  it('ignores actions other than a click on the notification', async () => {
    const { click } = await install()
    click(tap({ organizationId: ORGANIZATION, path: PATH }, 'dismiss'))
    await new Promise((resolve) => setTimeout(resolve))
    expect(invoke).not.toHaveBeenCalled()
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('registers a single listener when installed twice', async () => {
    const { installDesktopNotificationClicks } = await install()
    await installDesktopNotificationClicks(router, () => active)
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('does not listen in a browser', async () => {
    vi.unstubAllGlobals()
    await install()
    expect(onAction).not.toHaveBeenCalled()
  })
})

describe('desktop permission helpers', () => {
  beforeEach(() => {
    isPermissionGranted.mockReset()
    requestPermission.mockReset()
  })

  it('reads the permission without prompting and treats errors as not granted', async () => {
    const { desktopPermissionGranted } = await load()
    isPermissionGranted.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('x'))
    expect(await desktopPermissionGranted()).toBe(true)
    expect(await desktopPermissionGranted()).toBe(false)
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('requests again on demand and returns the answer', async () => {
    const { requestDesktopPermission } = await load()
    requestPermission.mockResolvedValueOnce('denied').mockResolvedValueOnce('granted')
    expect(await requestDesktopPermission()).toBe(false)
    expect(await requestDesktopPermission()).toBe(true)
    expect(requestPermission).toHaveBeenCalledTimes(2)
  })
})
