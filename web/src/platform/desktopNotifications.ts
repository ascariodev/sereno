import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  type ActionPerformed,
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'
import type { Router } from 'vue-router'
import { getNotificationPreferences } from '../api/notificationPreferences'
import type { AppNotification } from '../api/types'
import { notificationTarget } from '../notificationTarget'
import { notificationBody, notificationTitle } from '../notificationText'
import { safeRedirect } from '../router/safeRedirect'
import { isDesktop } from './desktop'

// Set by `installDesktopNotificationClicks`: without it the notifications carry no destination.
let router: Router | null = null

// Asked once per session: a denial is not asked again on every notification.
let permission: Promise<boolean> | null = null

function ensurePermission(): Promise<boolean> {
  permission ??= (async () => (await isPermissionGranted()) || (await requestPermission()) === 'granted')().catch(
    () => false,
  )
  return permission
}

/** Whether the OS currently lets this app show notifications; never prompts. */
export async function desktopPermissionGranted(): Promise<boolean> {
  try {
    return await isPermissionGranted()
  } catch {
    return false
  }
}

/** Explicit request from the preferences: asks again even if it was asked this session, and the answer replaces the cached one. */
export async function requestDesktopPermission(): Promise<boolean> {
  const granted = await requestPermission().then(
    (result) => result === 'granted',
    () => false,
  )
  permission = Promise.resolve(granted)
  return granted
}

function notificationPath(notification: AppNotification): string | null {
  const target = notificationTarget(notification)
  return router === null || target === null ? null : router.resolve(target).fullPath
}

async function windowHasAttention(): Promise<boolean> {
  const window = getCurrentWindow()
  const [visible, minimized, focused] = await Promise.all([window.isVisible(), window.isMinimized(), window.isFocused()])
  return visible && !minimized && focused
}

/**
 * Shows a native notification for a live inbox row on the desktop app, unless the window has the user's attention or the
 * `push` preference of its type is off. In the desktop app the `push` channel means "alerts on this device".
 * `activeOrganizationId` is read again after every await: it returns null once the session it belongs to is gone.
 */
export async function notifyDesktop(
  notification: AppNotification,
  organizationId: number,
  activeOrganizationId: () => number | null,
): Promise<void> {
  const isCurrent = () => activeOrganizationId() === organizationId
  if (!isDesktop() || !isCurrent()) return
  if (notification.type === 'unknown' || notification.read_at !== null) return
  try {
    if ((await windowHasAttention()) || !isCurrent()) return
    const preferences = await getNotificationPreferences()
    if (!isCurrent() || !preferences.push[notification.type]) return
    if (!(await ensurePermission()) || !isCurrent()) return
    const body = notificationBody(notification)
    const path = notificationPath(notification)
    sendNotification({
      title: notificationTitle(notification),
      ...(body === null ? {} : { body }),
      ...(path === null ? {} : { extra: { organizationId, path } }),
    })
  } catch {
    // A failed check or a missing notification is not worth interrupting the user for.
  }
}

async function openFromNotification(event: ActionPerformed, activeOrganizationId: () => number | null): Promise<void> {
  if (event.actionId !== 'tap') return
  await invoke('focus_main_window').catch(() => {})
  const extra = event.notification?.extra
  const path = safeRedirect(extra?.path)
  if (router === null || path === null || extra?.organizationId !== activeOrganizationId()) return
  await router.push(path).catch(() => {})
}

/**
 * On the desktop app, a click on a native notification brings the window back and opens its destination, as long as the
 * organization it belongs to is still the active one. Must run before the first notification: the plugin only reports
 * clicks on notifications shown while a listener existed (on Windows, only while the toast is on screen).
 */
export async function installDesktopNotificationClicks(
  appRouter: Router,
  activeOrganizationId: () => number | null,
): Promise<void> {
  if (!isDesktop()) return
  router = appRouter
  try {
    await onAction((event) => void openFromNotification(event, activeOrganizationId))
  } catch {
    // Without the listener a click only brings up whatever Windows does by default.
  }
}
