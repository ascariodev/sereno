import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import { disablePush, enablePush, getPushState, releasePushOnLogout, urlBase64ToUint8Array } from './push'

const KEY_B64URL = 'AQID-_8'
const KEY_BYTES = urlBase64ToUint8Array(KEY_B64URL)

interface FakeSub {
  endpoint: string
  options: { applicationServerKey: ArrayBuffer | null }
  toJSON: () => { keys?: { p256dh: string; auth: string } }
  getKey: () => ArrayBuffer | null
  unsubscribe: ReturnType<typeof vi.fn>
}

function makeSub(endpoint = 'https://push.example/1', key: Uint8Array | null = KEY_BYTES): FakeSub {
  return {
    endpoint,
    options: { applicationServerKey: key ? (key.buffer as ArrayBuffer) : null },
    toJSON: () => ({ keys: { p256dh: 'p256', auth: 'auth' } }),
    getKey: () => null,
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  }
}

let existing: FakeSub | null
let subscribed: FakeSub
let registration: { active: object | null; pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } } | undefined
let permission: NotificationPermission
let requestPermission: ReturnType<typeof vi.fn>

function setup(options: { registered?: boolean; permission?: NotificationPermission; existing?: FakeSub | null } = {}) {
  existing = options.existing ?? null
  subscribed = makeSub('https://push.example/new')
  permission = options.permission ?? 'default'
  requestPermission = vi.fn(async () => {
    permission = 'granted'
    return permission
  })
  registration =
    options.registered === false
      ? undefined
      : {
          active: {},
          pushManager: {
            getSubscription: vi.fn(async () => existing),
            subscribe: vi.fn(async () => subscribed),
          },
        }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn(async () => registration), ready: new Promise(() => {}) },
  })
  vi.stubGlobal('PushManager', { supportedContentEncodings: ['aesgcm', 'aes128gcm'] })
  vi.stubGlobal('Notification', {
    get permission() {
      return permission
    },
    requestPermission,
  })
}

beforeEach(() => {
  vi.spyOn(api, 'get').mockResolvedValue({ data: { public_key: KEY_B64URL } })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 1, endpoint: 'x', content_encoding: 'aes128gcm' } })
  vi.spyOn(api, 'delete').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url without padding', () => {
    expect(Array.from(KEY_BYTES)).toEqual([1, 2, 3, 251, 255])
  })
})

describe('getPushState', () => {
  it('is unsupported without a registered service worker (dev)', async () => {
    setup({ registered: false })
    expect(await getPushState()).toBe('unsupported')
  })

  it('is unsupported without PushManager', async () => {
    setup()
    Reflect.deleteProperty(window, 'PushManager')
    vi.stubGlobal('PushManager', undefined)
    delete (window as unknown as Record<string, unknown>).PushManager
    expect(await getPushState()).toBe('unsupported')
  })

  it('is blocked when the permission is denied', async () => {
    setup({ permission: 'denied' })
    expect(await getPushState()).toBe('blocked')
  })

  it('is inactive without permission or subscription, active with both', async () => {
    setup()
    expect(await getPushState()).toBe('inactive')
    setup({ permission: 'granted' })
    expect(await getPushState()).toBe('inactive')
    setup({ permission: 'granted', existing: makeSub() })
    expect(await getPushState()).toBe('active')
  })
})

describe('enablePush', () => {
  it('asks permission, subscribes with the VAPID key and registers the subscription', async () => {
    setup()
    expect(await enablePush()).toBe('active')
    expect(requestPermission).toHaveBeenCalledOnce()
    const args = registration!.pushManager.subscribe.mock.calls[0][0]
    expect(args.userVisibleOnly).toBe(true)
    expect(Array.from(args.applicationServerKey as Uint8Array)).toEqual(Array.from(KEY_BYTES))
    expect(api.post).toHaveBeenCalledWith('/api/me/push-subscriptions', {
      endpoint: 'https://push.example/new',
      public_key: 'p256',
      auth_token: 'auth',
      content_encoding: 'aes128gcm',
      user_agent: navigator.userAgent.slice(0, 512),
    })
  })

  it('falls back to aesgcm and omits the encoding when none is advertised', async () => {
    setup()
    vi.stubGlobal('PushManager', { supportedContentEncodings: ['aesgcm'] })
    await enablePush()
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ content_encoding: 'aesgcm' })

    setup()
    vi.stubGlobal('PushManager', {})
    await enablePush()
    expect(vi.mocked(api.post).mock.calls[1][1]).toHaveProperty('content_encoding', undefined)
  })

  it('returns blocked without subscribing when the permission is denied', async () => {
    setup({ permission: 'denied' })
    expect(await enablePush()).toBe('blocked')
    expect(registration!.pushManager.subscribe).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('returns blocked when the prompt is denied and inactive when dismissed', async () => {
    setup()
    requestPermission.mockResolvedValue('denied')
    expect(await enablePush()).toBe('blocked')
    setup()
    requestPermission.mockResolvedValue('default')
    expect(await enablePush()).toBe('inactive')
    expect(registration!.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('returns unsupported without a service worker registration', async () => {
    setup({ registered: false })
    expect(await enablePush()).toBe('unsupported')
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('reuses a subscription with the same VAPID key', async () => {
    const current = makeSub('https://push.example/current')
    setup({ permission: 'granted', existing: current })
    expect(await enablePush()).toBe('active')
    expect(current.unsubscribe).not.toHaveBeenCalled()
    expect(registration!.pushManager.subscribe).not.toHaveBeenCalled()
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ endpoint: 'https://push.example/current' })
  })

  it('replaces a subscription made with another VAPID key', async () => {
    const stale = makeSub('https://push.example/stale', new Uint8Array([9, 9, 9]))
    setup({ permission: 'granted', existing: stale })
    expect(await enablePush()).toBe('active')
    expect(stale.unsubscribe).toHaveBeenCalledOnce()
    expect(registration!.pushManager.subscribe).toHaveBeenCalledOnce()
  })

  it('does not leave a browser subscription when the API rejects it', async () => {
    setup({ permission: 'granted' })
    vi.mocked(api.post).mockRejectedValue(new ApiError(500, 'boom'))
    await expect(enablePush()).rejects.toBeInstanceOf(ApiError)
    expect(subscribed.unsubscribe).toHaveBeenCalledOnce()
  })

  it('propagates a 503 for the VAPID key without subscribing', async () => {
    setup({ permission: 'granted' })
    vi.mocked(api.get).mockRejectedValue(new ApiError(503, 'not configured'))
    await expect(enablePush()).rejects.toMatchObject({ status: 503 })
    expect(registration!.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('drops the work when the session ends while the key is loading', async () => {
    setup({ permission: 'granted' })
    let resolveKey!: (value: unknown) => void
    vi.mocked(api.get).mockReturnValue(new Promise((resolve) => (resolveKey = resolve)))
    const pending = enablePush()
    await releasePushOnLogout()
    resolveKey({ data: { public_key: KEY_B64URL } })
    expect(await pending).toBe('inactive')
    expect(registration!.pushManager.subscribe).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('undoes the subscription when the session ends while it is being registered', async () => {
    setup({ permission: 'granted' })
    let resolvePost!: (value: unknown) => void
    vi.mocked(api.post).mockReturnValue(new Promise((resolve) => (resolvePost = resolve)))
    const pending = enablePush()
    await vi.waitFor(() => expect(api.post).toHaveBeenCalled())
    await releasePushOnLogout()
    resolvePost({ data: {} })
    expect(await pending).toBe('inactive')
    expect(subscribed.unsubscribe).toHaveBeenCalled()
    expect(api.delete).toHaveBeenCalledWith('/api/me/push-subscriptions', { query: { endpoint: 'https://push.example/new' } })
  })
})

describe('disablePush', () => {
  it('deletes the subscription in the API and unsubscribes the browser', async () => {
    const current = makeSub('https://push.example/current')
    setup({ permission: 'granted', existing: current })
    expect(await disablePush()).toBe('inactive')
    expect(api.delete).toHaveBeenCalledWith('/api/me/push-subscriptions', { query: { endpoint: 'https://push.example/current' } })
    expect(current.unsubscribe).toHaveBeenCalledOnce()
  })

  it('tolerates a 404 from the API', async () => {
    const current = makeSub()
    setup({ permission: 'granted', existing: current })
    vi.mocked(api.delete).mockRejectedValue(new ApiError(404, 'Not Found'))
    await disablePush()
    expect(current.unsubscribe).toHaveBeenCalledOnce()
  })

  it('keeps the browser subscription when the API fails otherwise', async () => {
    const current = makeSub()
    setup({ permission: 'granted', existing: current })
    vi.mocked(api.delete).mockRejectedValue(new ApiError(500, 'boom'))
    await expect(disablePush()).rejects.toBeInstanceOf(ApiError)
    expect(current.unsubscribe).not.toHaveBeenCalled()
  })
})

describe('releasePushOnLogout', () => {
  it('does nothing without service worker support', async () => {
    setup({ registered: false })
    await releasePushOnLogout()
    expect(api.delete).not.toHaveBeenCalled()
  })

  it('deletes in the API and unsubscribes the browser', async () => {
    const current = makeSub()
    setup({ permission: 'granted', existing: current })
    await releasePushOnLogout()
    expect(api.delete).toHaveBeenCalledOnce()
    expect(current.unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not throw and still unsubscribes when the API fails', async () => {
    const current = makeSub()
    setup({ permission: 'granted', existing: current })
    vi.mocked(api.delete).mockRejectedValue(new ApiError(500, 'boom'))
    await expect(releasePushOnLogout()).resolves.toBeUndefined()
    expect(current.unsubscribe).toHaveBeenCalledOnce()
  })

  it('gives up waiting for a slow API after the timeout', async () => {
    vi.useFakeTimers()
    const current = makeSub()
    setup({ permission: 'granted', existing: current })
    vi.mocked(api.delete).mockReturnValue(new Promise(() => {}))
    const done = vi.fn()
    const pending = releasePushOnLogout(1000).then(done)
    await vi.advanceTimersByTimeAsync(999)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(current.unsubscribe).toHaveBeenCalledOnce()
  })

  it('cancels the timeout once the API answers', async () => {
    vi.useFakeTimers()
    setup({ permission: 'granted', existing: makeSub() })
    await releasePushOnLogout()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not throw when the registration lookup fails', async () => {
    setup()
    vi.mocked(navigator.serviceWorker.getRegistration).mockRejectedValue(new Error('boom'))
    await expect(releasePushOnLogout()).resolves.toBeUndefined()
  })
})
