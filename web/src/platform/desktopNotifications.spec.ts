import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationPreferences, TaskAssignedNotification } from '../api/types'

const windowState = vi.hoisted(() => ({ visible: true, minimized: false, focused: true }))
const getCurrentWindow = vi.hoisted(() => vi.fn())
const isPermissionGranted = vi.hoisted(() => vi.fn())
const requestPermission = vi.hoisted(() => vi.fn())
const sendNotification = vi.hoisted(() => vi.fn())
const getNotificationPreferences = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow }))
vi.mock('@tauri-apps/plugin-notification', () => ({ isPermissionGranted, requestPermission, sendNotification }))
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
