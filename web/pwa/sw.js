const CACHE_PREFIX = 'sereno-'
const CACHE = CACHE_PREFIX + '__VERSION__'
const PRECACHE = __PRECACHE__
const APP_SHELL = '/index.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE)),
  )
})

// An update waits until the app accepts it, so an open session never mixes versions.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

async function networkFirst(request, fallback) {
  try {
    return await fetch(request)
  } catch (error) {
    const cached = await caches.match(fallback ?? request)
    if (cached) return cached
    throw error
  }
}

// The API and Reverb live on other origins and are never intercepted.
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, APP_SHELL))
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
  } else {
    event.respondWith(networkFirst(request))
  }
})

const FALLBACK_URL = '/'
const ICON = '/icons/icon-192.png'

function sameOriginUrl(value) {
  const fallback = new URL(FALLBACK_URL, self.location.origin).href
  if (typeof value !== 'string') return fallback
  try {
    const url = new URL(value, self.location.origin)
    return url.origin === self.location.origin ? url.href : fallback
  } catch {
    return fallback
  }
}

function readPush(data) {
  let payload
  try {
    payload = data?.json()
  } catch {
    payload = null
  }
  const valid =
    payload !== null &&
    typeof payload === 'object' &&
    typeof payload.title === 'string' &&
    payload.title !== '' &&
    typeof payload.body === 'string' &&
    typeof payload.url === 'string' &&
    typeof payload.tag === 'string' &&
    payload.tag !== ''
  // A malformed push still shows something: Chrome would otherwise show its own generic notice.
  if (!valid) {
    return {
      title: 'Sereno',
      options: { icon: ICON, tag: 'sereno', renotify: true, data: { url: sameOriginUrl(FALLBACK_URL) } },
    }
  }
  // renotify throws without a tag, so an empty one is rejected above.
  return {
    title: payload.title,
    options: {
      body: payload.body,
      icon: ICON,
      tag: payload.tag,
      renotify: true,
      data: { url: sameOriginUrl(payload.url) },
    },
  }
}

function windowClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
}

// With a focused Sereno window the in-app inbox already shows it.
async function showPush(data) {
  const clients = await windowClients()
  if (clients.some((client) => client.focused)) return
  const { title, options } = readPush(data)
  await self.registration.showNotification(title, options)
}

// The SPA navigates with its router on this message: WindowClient.navigate would reload it.
async function openFromNotification(url) {
  const [controlled, all] = await Promise.all([self.clients.matchAll({ type: 'window' }), windowClients()])
  const client = controlled[0] ?? all[0]
  if (client) {
    try {
      await client.focus()
      client.postMessage({ type: 'NAVIGATE', url })
      return
    } catch {
      // A window that cannot be focused or messaged is replaced by a new one.
    }
  }
  await self.clients.openWindow(url)
}

self.addEventListener('push', (event) => {
  event.waitUntil(showPush(event.data))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openFromNotification(sameOriginUrl(event.notification.data?.url)))
})
