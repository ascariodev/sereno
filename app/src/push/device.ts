import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { useEffect } from 'react'
import { AppState, Platform } from 'react-native'
import { create } from 'zustand'

import { api } from '@/api/client'
import { i18n } from '@/i18n'
import { deviceName } from '@/session/deviceName'
import { PUSH_PROMPTED_STORAGE_KEY, readStored, writeStored } from '@/session/storage'

export type PushState = 'unsupported' | 'blocked' | 'active' | 'inactive'

export const ANDROID_CHANNEL_ID = 'default'
export const LOGOUT_PUSH_TIMEOUT = 3000

export const usePushStore = create<{ state: PushState | null }>()(() => ({ state: null }))

// Bumped on logout and session loss: a registration that started under another session is discarded.
let generation = 0
let registeredToken: string | null = null
let pendingSync: { generation: number; promise: Promise<void> } | null = null

// Expo Go cannot receive remote push on Android; iOS waits for its own plan.
function pushSupported(): boolean {
  return Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
}

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId
}

function setState(state: PushState): PushState {
  usePushStore.setState({ state })
  return state
}

function deniedState(permissions: Notifications.NotificationPermissionsStatus): PushState {
  return permissions.canAskAgain ? 'inactive' : 'blocked'
}

function deleteToken(token: string): Promise<void> {
  return api.delete('/api/me/expo-push-tokens', { query: { token } })
}

async function register(
  shouldPrompt: (permissions: Notifications.NotificationPermissionsStatus) => boolean,
  devicePushToken?: Notifications.DevicePushToken,
  onPrompt?: () => Promise<void>,
): Promise<PushState> {
  if (!pushSupported()) return setState('unsupported')
  const mine = generation
  // Android 13+ only shows the permission prompt once a channel exists.
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: i18n.t('push.channelName'),
    importance: Notifications.AndroidImportance.HIGH,
  })
  let permissions = await Notifications.getPermissionsAsync()
  if (!permissions.granted && shouldPrompt(permissions)) {
    await onPrompt?.()
    permissions = await Notifications.requestPermissionsAsync()
  }
  if (mine !== generation) return 'inactive'
  if (!permissions.granted) return setState(deniedState(permissions))

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId(), devicePushToken })
  if (mine !== generation) return 'inactive'
  // Expo maps the new device token on getExpoPushTokenAsync; the API only needs to know about a new Expo token.
  if (devicePushToken && token === registeredToken) return setState('active')
  await api.post('/api/me/expo-push-tokens', { token, platform: Platform.OS, device_name: deviceName() })
  if (mine !== generation) return 'inactive'
  const previous = registeredToken
  registeredToken = token
  if (previous && previous !== token) deleteToken(previous).catch(() => {})
  return setState('active')
}

export function enablePush(): Promise<PushState> {
  return register((permissions) => permissions.canAskAgain)
}

// Prompts once per installation (Android 13+ reports 'denied' before the first ask): a denial is respected until the person enables push from Settings.
// A rotated device token arriving mid-sync runs once more after it, so the new token is not lost.
export function syncPush(devicePushToken?: Notifications.DevicePushToken): Promise<void> {
  const mine = generation
  const pending = pendingSync?.generation === mine ? pendingSync.promise : null
  if (pending && !devicePushToken) return pending
  const sync = {
    generation: mine,
    promise: (pending ?? Promise.resolve())
      .then(() => {
        if (mine !== generation) return
        return readStored(PUSH_PROMPTED_STORAGE_KEY).then((prompted) =>
          register(
            (permissions) => prompted === null && permissions.canAskAgain,
            devicePushToken,
            () => writeStored(PUSH_PROMPTED_STORAGE_KEY, '1'),
          ),
        )
      })
      .then(() => {})
      .catch(() => {
        // retried on the next start, on resume or from Settings
      })
      .finally(() => {
        if (pendingSync === sync) pendingSync = null
      }),
  }
  pendingSync = sync
  return sync.promise
}

export async function refreshPushState(): Promise<PushState> {
  if (!pushSupported()) return setState('unsupported')
  const permissions = await Notifications.getPermissionsAsync()
  if (!permissions.granted) return setState(deniedState(permissions))
  return setState(registeredToken ? 'active' : 'inactive')
}

export function forgetPushRegistration(): void {
  generation++
  registeredToken = null
  usePushStore.setState({ state: null })
}

// Must run while the access token is still valid; logging out never waits on it past the timeout.
export async function releasePushOnLogout(timeoutMs = LOGOUT_PUSH_TIMEOUT): Promise<void> {
  const token = registeredToken
  forgetPushRegistration()
  if (!token) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))
  try {
    await Promise.race([deleteToken(token).catch(() => {}), limit])
  } finally {
    clearTimeout(timer)
  }
}

export function usePushRegistration(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn || !pushSupported()) return
    void syncPush()
    const tokenSubscription = Notifications.addPushTokenListener((devicePushToken) => void syncPush(devicePushToken))
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && registeredToken === null) void syncPush()
    })
    return () => {
      tokenSubscription.remove()
      appStateSubscription.remove()
    }
  }, [signedIn])
}
