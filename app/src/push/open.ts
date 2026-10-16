import * as Notifications from 'expo-notifications'
import { router, useRootNavigationState } from 'expo-router'
import { useEffect } from 'react'

import type { NotificationTarget } from '@/notifications/target'
import { useOrganizationStore } from '@/organization/store'
import { useAuthStore } from '@/session/auth'

export interface PushDestination {
  organizationId: number
  target: NotificationTarget
}

export const foregroundBehavior: Notifications.NotificationBehavior = {
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
}

// In the foreground the person is already in the app and the in-app inbox updates live.
Notifications.setNotificationHandler({ handleNotification: async () => foregroundBehavior })

function positiveId(value: unknown): number | null {
  const id = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  return Number.isInteger(id) && id > 0 ? id : null
}

// The API sends the web URL (PushPayload::mobile), not an app route.
export function pushDestination(data: unknown): PushDestination | null {
  if (typeof data !== 'object' || data === null) return null
  const { url, organizationId: rawOrganizationId } = data as { url?: unknown; organizationId?: unknown }
  const organizationId = positiveId(rawOrganizationId)
  if (organizationId === null || typeof url !== 'string') return null

  const [path = '', query = ''] = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '').split('#')[0]!.split('?')
  const param = (name: string) => new RegExp(`(?:^|&)${name}=([^&]*)`).exec(query)?.[1]
  const plan = /^\/projects\/(\d+)\/plan\/?$/.exec(path)
  if (plan) {
    const taskId = positiveId(param('task'))
    if (taskId === null) return null
    return { organizationId, target: { pathname: '/task', params: { projectId: String(Number(plan[1])), id: String(taskId) } } }
  }

  const channel = /^\/channels\/(\d+)\/?$/.exec(path)
  if (!channel) return null
  const channelId = String(Number(channel[1]))
  const threadId = positiveId(param('thread'))
  if (threadId !== null) return { organizationId, target: { pathname: '/thread', params: { channelId, id: String(threadId) } } }
  return { organizationId, target: { pathname: '/channel', params: { id: channelId } } }
}

let lastHandled: string | null = null

// Requires a signed-in session: a tap on a push never navigates (or switches organization) without one.
export async function openPushResponse(response: Notifications.NotificationResponse): Promise<void> {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return
  const identifier = response.notification.request.identifier
  if (identifier === lastHandled) return
  lastHandled = identifier
  // The native side keeps the response across restarts: clear it before anything else so a later start does not replay it.
  Notifications.clearLastNotificationResponse()

  if (useAuthStore.getState().token === null) return
  const destination = pushDestination(response.notification.request.content.data)
  if (destination === null) return

  const organizationState = useOrganizationStore.getState()
  if (organizationState.activeId !== destination.organizationId) {
    if (!organizationState.loaded || organizationState.loadError) {
      await organizationState.load()
      if (useAuthStore.getState().token === null) return
    }
    await useOrganizationStore.getState().select(destination.organizationId)
    if (useAuthStore.getState().token === null) return
    if (useOrganizationStore.getState().activeId !== destination.organizationId) return
  }
  router.push(destination.target)
}

// `ready` is true once the root stack is mounted with its guards settled; navigating while the navigator mounts crashes the native renderer.
export function usePushOpen(ready: boolean): void {
  const navigationReady = useRootNavigationState()?.key != null
  const active = ready && navigationReady
  useEffect(() => {
    if (!active) return
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => void openPushResponse(response))
    const timer = setTimeout(() => {
      const last = Notifications.getLastNotificationResponse()
      if (last) void openPushResponse(last)
    }, 0)
    return () => {
      clearTimeout(timer)
      subscription.remove()
    }
  }, [active])
}

export function resetPushOpen(): void {
  lastHandled = null
}
