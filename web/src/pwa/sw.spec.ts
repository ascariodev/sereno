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

const response = (body: string, ok = true): FakeResponse => ({ body, ok, clone: () => response(body, ok) })

const request = (path: string, { method = 'GET', mode = 'cors', origin = ORIGIN } = {}): FakeRequest => ({
  url: origin + path,
  method,
  mode,
})

const keyOf = (input: string | FakeRequest) => (typeof input === 'string' ? input : new URL(input.url).pathname)

function loadWorker(existingCaches: string[] = []) {
  const listeners = new Map<string, Listener>()
  const stores = new Map<string, Map<string, FakeResponse>>(existingCaches.map((name) => [name, new Map()]))
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(() => Promise.resolve()) },
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

  const waitFor = async (type: string, data?: unknown) => {
    let pending: Promise<unknown> = Promise.resolve()
    listeners.get(type)!({ data, waitUntil: (promise: Promise<unknown>) => (pending = promise) })
    await pending
  }

  const handle = (input: FakeRequest): Promise<FakeResponse> | undefined => {
    let responded: Promise<FakeResponse> | undefined
    listeners.get('fetch')!({ request: input, respondWith: (promise: Promise<FakeResponse>) => (responded = promise) })
    return responded
  }

  return { self, stores, fetch, waitFor, handle }
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
})
