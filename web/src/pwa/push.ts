import { deletePushSubscription, getVapidPublicKey, storePushSubscription } from '../api/pushSubscriptions'
import type { PushContentEncoding } from '../api/types'
import { isDesktop } from '../platform/desktop'

export type PushState = 'unsupported' | 'blocked' | 'active' | 'inactive'

export class PushSubscribeError extends Error {
  constructor(cause: unknown) {
    super('The browser could not create the push subscription', { cause })
    this.name = 'PushSubscribeError'
  }
}

export const LOGOUT_PUSH_TIMEOUT = 3000
const READY_TIMEOUT = 10000

let generation = 0

function browserSupportsPush(): boolean {
  return !isDesktop() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function timeout<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

// getRegistration resolves to undefined when no service worker is registered (dev), so it never hangs there.
async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!browserSupportsPush()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return null
  if (registration.active) return registration
  return Promise.race([navigator.serviceWorker.ready, timeout(READY_TIMEOUT, null)])
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const raw = atob(padded)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function bytesToBase64Url(buffer: ArrayBuffer | null): string | null {
  if (!buffer) return null
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options?.applicationServerKey
  if (!current) return false
  const bytes = new Uint8Array(current)
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i])
}

function contentEncoding(): PushContentEncoding | undefined {
  const supported: readonly string[] = PushManager.supportedContentEncodings ?? []
  if (supported.includes('aes128gcm')) return 'aes128gcm'
  if (supported.includes('aesgcm')) return 'aesgcm'
  return undefined
}

export async function getPushState(): Promise<PushState> {
  const registration = await getRegistration()
  if (!registration) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission !== 'granted') return 'inactive'
  return (await registration.pushManager.getSubscription()) ? 'active' : 'inactive'
}

export async function enablePush(): Promise<PushState> {
  const startedAt = generation
  const registration = await getRegistration()
  if (startedAt !== generation) return 'inactive'
  if (!registration) return 'unsupported'

  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  if (startedAt !== generation) return 'inactive'
  if (permission === 'denied') return 'blocked'
  if (permission !== 'granted') return 'inactive'

  const key = urlBase64ToUint8Array(await getVapidPublicKey())
  if (startedAt !== generation) return 'inactive'

  let subscription = await registration.pushManager.getSubscription()
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe()
    subscription = null
  }
  if (startedAt !== generation) return 'inactive'
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch((error: unknown) => {
    throw new PushSubscribeError(error)
  })
  if (startedAt !== generation) {
    await subscription.unsubscribe().catch(() => {})
    return 'inactive'
  }

  const json = subscription.toJSON()
  const publicKey = json.keys?.p256dh ?? bytesToBase64Url(subscription.getKey('p256dh'))
  const authToken = json.keys?.auth ?? bytesToBase64Url(subscription.getKey('auth'))
  try {
    if (!publicKey || !authToken) throw new Error('Push subscription without keys')
    await storePushSubscription({
      endpoint: subscription.endpoint,
      public_key: publicKey,
      auth_token: authToken,
      content_encoding: contentEncoding(),
      user_agent: navigator.userAgent.slice(0, 512),
    })
  } catch (error) {
    await subscription.unsubscribe().catch(() => {})
    throw error
  }
  if (startedAt !== generation) {
    await deletePushSubscription(subscription.endpoint).catch(() => {})
    await subscription.unsubscribe().catch(() => {})
    return 'inactive'
  }
  return 'active'
}

export async function disablePush(): Promise<PushState> {
  generation++
  const registration = await getRegistration()
  if (!registration) return 'unsupported'
  const subscription = await registration.pushManager.getSubscription()
  if (subscription) {
    await deletePushSubscription(subscription.endpoint)
    await subscription.unsubscribe()
  }
  return Notification.permission === 'denied' ? 'blocked' : 'inactive'
}

export async function releasePushOnLogout(timeoutMs = LOGOUT_PUSH_TIMEOUT): Promise<void> {
  generation++
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))
  try {
    await Promise.race([releaseWithin(limit), limit])
  } finally {
    clearTimeout(timer)
  }
}

async function releaseWithin(limit: Promise<void>): Promise<void> {
  try {
    const registration = browserSupportsPush() ? await navigator.serviceWorker.getRegistration() : undefined
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return
    await Promise.race([deletePushSubscription(subscription.endpoint).catch(() => {}), limit])
    await subscription.unsubscribe()
  } catch {
    // Logging out must not depend on push cleanup.
  }
}

export async function dropPushOnSessionExpired(): Promise<void> {
  generation++
  try {
    const registration = browserSupportsPush() ? await navigator.serviceWorker.getRegistration() : undefined
    await (await registration?.pushManager.getSubscription())?.unsubscribe()
  } catch {
    // Without a token the API row cannot be removed; the browser side is best effort.
  }
}
