import { getCurrentWindow } from '@tauri-apps/api/window'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { getNotificationPreferences } from '../api/notificationPreferences'
import type { AppNotification } from '../api/types'
import { notificationBody, notificationTitle } from '../notificationText'
import { isDesktop } from './desktop'

// Asked once per session: a denial is not asked again on every notification.
let permission: Promise<boolean> | null = null

function ensurePermission(): Promise<boolean> {
  permission ??= (async () => (await isPermissionGranted()) || (await requestPermission()) === 'granted')().catch(
    () => false,
  )
  return permission
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
    sendNotification({ title: notificationTitle(notification), ...(body === null ? {} : { body }) })
  } catch {
    // A failed check or a missing notification is not worth interrupting the user for.
  }
}
