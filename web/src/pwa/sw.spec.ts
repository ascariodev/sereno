import { describe, expect, it, vi } from 'vitest'
import template from '../../pwa/sw.js?raw'

const ORIGIN = 'https://sereno.test'
const PRECACHE = ['/index.html', '/assets/app-1.js']

interface FakeRequest {
  url: string
  method: string
  mode: string
}

interface FakeResponse {
  body: string
  ok: boolean
  clone: () => FakeResponse
}

type Listener = (event: Record<string, unknown>) => void

interface FakeWindow {
  focused: boolean
  focus: ReturnType<typeof vi.fn>
  navigate: ReturnType<typeof vi.fn>
}

const later = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value)))

const fakeWindow = ({ focused = false, navigable = true } = {}): FakeWindow => {
  const client: FakeWindow = {
    focused,
    focus: vi.fn(() => later(client)),
    navigate: vi.fn(() => (navigable ? later(client) : Promise.reject(new TypeError('not controlled')))),
  }
  return client
}

const pushData = (payload: unknown) => ({
  json: () => (typeof payload === 'string' ? JSON.parse(payload) : payload),
})

const PAYLOAD = {
  uuid: 'abc',
  type: 'task_assigned',
  title: 'Task assigned',
  body: 'Fix the login',
  url: `${ORIGIN}/projects/1/plan?task=2&organization=3`,
  tag: 'task-2',
}

const response = (body: string, ok = true): FakeResponse => ({ body, ok, clone: () => response(body, ok) })

const request = (path: string, { method = 'GET', mode = 'cors', origin = ORIGIN } = {}): FakeRequest => ({
  url: origin + path,
  method,
  mode,
})

const keyOf = (input: string | FakeRequest) => (typeof input === 'string' ? input : new URL(input.url).pathname)

function loadWorker(existingCaches: string[] = [], windows: FakeWindow[] = []) {
  const listeners = new Map<string, Listener>()
  const stores = new Map<string, Map<string, FakeResponse>>(existingCaches.map((name) => [name, new Map()]))
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(() => Promise.resolve()),
      matchAll: vi.fn(() => later(windows)),
      openWindow: vi.fn(() => later(null)),
    },
    registration: { showNotification: vi.fn(() => later(undefined)) },
  }
  const store = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    return stores.get(name)!
  }
  const caches = {
    open: async (name: string) => ({
      addAll: async (paths: string[]) => paths.forEach((path) => store(name).set(path, response(`cached ${path}`))),
      put: async (input: FakeRequest, value: FakeResponse) => void store(name).set(keyOf(input), value),
    }),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (input: string | FakeRequest) => {
      for (const entries of stores.values()) {
        const hit = entries.get(keyOf(input))
        if (hit) return hit
      }
      return undefined
    },
  }
  const fetch = vi.fn<(input: FakeRequest) => Promise<FakeResponse>>()

  const source = template.replace('__VERSION__', 'v2').replace('__PRECACHE__', JSON.stringify(PRECACHE))
  new Function('self', 'caches', 'fetch', source)(self, caches, fetch)

  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve()
    listeners.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => (pending = promise) })
    await pending
  }

  const waitFor = (type: string, data?: unknown) => dispatch(type, { data })

  const click = async (data: unknown) => {
    const notification = { data, close: vi.fn() }
    await dispatch('notificationclick', { notification })
    return notification
  }

  const handle = (input: FakeRequest): Promise<FakeResponse> | undefined => {
    let responded: Promise<FakeResponse> | undefined
    listeners.get('fetch')!({ request: input, respondWith: (promise: Promise<FakeResponse>) => (responded = promise) })
    return responded
  }

  return { self, stores, fetch, waitFor, handle, click }
}

describe('sw.js', () => {
  it('precaches the build on install without taking over', async () => {
    const { self, stores, waitFor } = loadWorker()
    await waitFor('install')
    expect([...stores.get('sereno-v2')!.keys()]).toEqual(PRECACHE)
    expect(self.skipWaiting).not.toHaveBeenCalled()
  })

  it('takes over only when the app asks for it', async () => {
    const { self, waitFor } = loadWorker()
    await waitFor('message', { type: 'OTHER' })
    expect(self.skipWaiting).not.toHaveBeenCalled()
    await waitFor('message', { type: 'SKIP_WAITING' })
    expect(self.skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('deletes older versions on activate and claims the clients', async () => {
    const { self, stores, waitFor } = loadWorker(['sereno-v1', 'sereno-v2', 'other-cache'])
    await waitFor('activate')
    expect([...stores.keys()].sort()).toEqual(['other-cache', 'sereno-v2'])
    expect(self.clients.claim).toHaveBeenCalledTimes(1)
  })

  it('does not intercept writes or other origins', () => {
    const { handle } = loadWorker()
    expect(handle(request('/assets/app-1.js', { method: 'POST' }))).toBeUndefined()
    expect(handle(request('/api/projects', { origin: 'https://api.sereno.test' }))).toBeUndefined()
  })

  it('serves navigations from the network and falls back to the app shell offline', async () => {
    const { fetch, waitFor, handle } = loadWorker()
    await waitFor('install')
    fetch.mockResolvedValueOnce(response('fresh page'))
    expect((await handle(request('/projects/1', { mode: 'navigate' })))?.body).toBe('fresh page')

    fetch.mockRejectedValueOnce(new TypeError('offline'))
    expect((await handle(request('/projects/1', { mode: 'navigate' })))?.body).toBe('cached /index.html')
  })

  it('serves hashed assets from the cache and stores the ones it lacks', async () => {
    const { fetch, stores, waitFor, handle } = loadWorker()
    await waitFor('install')
    expect((await handle(request('/assets/app-1.js')))?.body).toBe('cached /assets/app-1.js')
    expect(fetch).not.toHaveBeenCalled()

    fetch.mockResolvedValueOnce(response('lazy chunk'))
    expect((await handle(request('/assets/lazy-1.js')))?.body).toBe('lazy chunk')
    expect(stores.get('sereno-v2')!.get('/assets/lazy-1.js')?.body).toBe('lazy chunk')
  })

  it('does not store failed asset responses', async () => {
    const { fetch, stores, handle } = loadWorker()
    fetch.mockResolvedValueOnce(response('not found', false))
    expect((await handle(request('/assets/missing.js')))?.ok).toBe(false)
    expect(stores.get('sereno-v2')?.has('/assets/missing.js')).toBeFalsy()
  })

  it('serves other files from the network first and from the cache offline', async () => {
    const { fetch, waitFor, handle } = loadWorker()
    await waitFor('install')
    fetch.mockResolvedValueOnce(response('fresh shell'))
    expect((await handle(request('/index.html')))?.body).toBe('fresh shell')

    fetch.mockRejectedValueOnce(new TypeError('offline'))
    expect((await handle(request('/index.html')))?.body).toBe('cached /index.html')

    fetch.mockRejectedValueOnce(new TypeError('offline'))
    await expect(handle(request('/favicon.svg'))).rejects.toThrow('offline')
  })

  it('shows a push with its content when no Sereno window is focused', async () => {
    const { self, waitFor } = loadWorker([], [fakeWindow()])
    await waitFor('push', pushData(PAYLOAD))
    expect(self.registration.showNotification).toHaveBeenCalledWith('Task assigned', {
      body: 'Fix the login',
      icon: '/icons/icon-192.png',
      tag: 'task-2',
      data: { url: PAYLOAD.url },
    })
  })

  it('does not show a push while a Sereno window is focused', async () => {
    const { self, waitFor } = loadWorker([], [fakeWindow(), fakeWindow({ focused: true })])
    await waitFor('push', pushData(PAYLOAD))
    expect(self.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true })
    expect(self.registration.showNotification).not.toHaveBeenCalled()
  })

  it.each([
    ['no data', null],
    ['invalid json', pushData('{not json')],
    ['a non object', pushData('"text"')],
    ['an empty title', pushData({ ...PAYLOAD, title: '' })],
    ['a non string body', pushData({ ...PAYLOAD, body: 3 })],
    ['a missing url', pushData({ ...PAYLOAD, url: undefined })],
    ['a missing tag', pushData({ ...PAYLOAD, tag: undefined })],
  ])('shows a generic notice for a push with %s', async (_, data) => {
    const { self, waitFor } = loadWorker()
    await waitFor('push', data)
    expect(self.registration.showNotification).toHaveBeenCalledWith('Sereno', {
      icon: '/icons/icon-192.png',
      tag: 'sereno',
      data: { url: '/' },
    })
  })

  it('keeps the content of a push whose url is on another origin but points it to the app root', async () => {
    const { self, waitFor } = loadWorker()
    await waitFor('push', pushData({ ...PAYLOAD, url: 'https://evil.test/phish' }))
    expect(self.registration.showNotification).toHaveBeenCalledWith(
      'Task assigned',
      expect.objectContaining({ body: 'Fix the login', data: { url: `${ORIGIN}/` } }),
    )
  })

  it('focuses an open window and navigates it on click', async () => {
    const existing = fakeWindow()
    const { self, click } = loadWorker([], [existing])
    const notification = await click({ url: PAYLOAD.url })
    expect(notification.close).toHaveBeenCalledTimes(1)
    expect(existing.focus).toHaveBeenCalledTimes(1)
    expect(existing.navigate).toHaveBeenCalledWith(PAYLOAD.url)
    expect(self.clients.openWindow).not.toHaveBeenCalled()
  })

  it('opens a new window on click when none is open', async () => {
    const { self, click } = loadWorker()
    await click({ url: PAYLOAD.url })
    expect(self.clients.openWindow).toHaveBeenCalledWith(PAYLOAD.url)
  })

  it('opens a new window on click when the open one cannot be navigated', async () => {
    const existing = fakeWindow({ navigable: false })
    const { self, click } = loadWorker([], [existing])
    await click({ url: PAYLOAD.url })
    expect(existing.navigate).toHaveBeenCalledWith(PAYLOAD.url)
    expect(self.clients.openWindow).toHaveBeenCalledWith(PAYLOAD.url)
  })

  it.each([
    ['another origin', { url: 'https://evil.test/phish' }],
    ['a non string url', { url: 42 }],
    ['no data', undefined],
  ])('opens the app root on click for a url with %s', async (_, data) => {
    const { self, click } = loadWorker()
    await click(data)
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`)
  })
})
