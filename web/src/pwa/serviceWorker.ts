export const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000

export interface ServiceWorkerOptions {
  onUpdateReady: (applyUpdate: () => void) => void
  url?: string
  container?: ServiceWorkerContainer
  reload?: () => void
}

export async function registerServiceWorker({
  onUpdateReady,
  url = '/sw.js',
  container = navigator.serviceWorker,
  reload = () => window.location.reload(),
}: ServiceWorkerOptions): Promise<void> {
  const registration = await container.register(url)
  let notified = false
  let reloading = false

  const notify = (worker: ServiceWorker) => {
    if (notified) return
    notified = true
    onUpdateReady(() => worker.postMessage({ type: 'SKIP_WAITING' }))
  }

  // The first install also changes the controller (clients.claim); only an accepted update reloads.
  container.addEventListener('controllerchange', () => {
    if (!notified || reloading) return
    reloading = true
    reload()
  })

  if (registration.waiting && container.controller) notify(registration.waiting)

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && container.controller) notify(worker)
    })
  })

  const checkForUpdate = () => {
    registration.update().catch(() => {})
  }
  setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
}

export interface NavigationOptions {
  navigate: (path: string) => void
  container?: ServiceWorkerContainer
  origin?: string
}

function sameOriginPath(url: string, origin: string): string | null {
  try {
    const parsed = new URL(url, origin)
    return parsed.origin === origin ? parsed.pathname + parsed.search + parsed.hash : null
  } catch {
    return null
  }
}

export function listenForNavigation({
  navigate,
  container = navigator.serviceWorker,
  origin = window.location.origin,
}: NavigationOptions): void {
  container.addEventListener('message', (event) => {
    const data: unknown = event.data
    if (typeof data !== 'object' || data === null) return
    const { type, url } = data as { type?: unknown; url?: unknown }
    if (type !== 'NAVIGATE' || typeof url !== 'string') return
    const path = sameOriginPath(url, origin)
    if (path) navigate(path)
  })
}
