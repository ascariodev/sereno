import { afterEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_CHECK_INTERVAL, registerServiceWorker } from './serviceWorker'

class FakeWorker extends EventTarget {
  state = 'installing'
  postMessage = vi.fn()

  moveTo(state: string): void {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null
  waiting: FakeWorker | null = null
  update = vi.fn(() => Promise.resolve())

  findUpdate(): FakeWorker {
    const worker = new FakeWorker()
    this.installing = worker
    this.dispatchEvent(new Event('updatefound'))
    return worker
  }
}

async function setup({ controlled = true, waiting = null as FakeWorker | null } = {}) {
  const registration = new FakeRegistration()
  registration.waiting = waiting
  const container = Object.assign(new EventTarget(), {
    controller: controlled ? {} : null,
    register: vi.fn(() => Promise.resolve(registration)),
  })
  const onUpdateReady = vi.fn()
  const reload = vi.fn()
  await registerServiceWorker({
    onUpdateReady,
    reload,
    container: container as unknown as ServiceWorkerContainer,
  })
  return { registration, container, onUpdateReady, reload }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('registerServiceWorker', () => {
  it('registers /sw.js', async () => {
    const { container } = await setup()
    expect(container.register).toHaveBeenCalledWith('/sw.js')
  })

  it('does not announce or reload on the first install', async () => {
    const { registration, container, onUpdateReady, reload } = await setup({ controlled: false })
    registration.findUpdate().moveTo('installed')
    container.dispatchEvent(new Event('controllerchange'))
    expect(onUpdateReady).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('announces an installed update and only activates it when accepted', async () => {
    const { registration, container, onUpdateReady, reload } = await setup()
    const worker = registration.findUpdate()
    worker.moveTo('installed')
    expect(onUpdateReady).toHaveBeenCalledTimes(1)
    expect(worker.postMessage).not.toHaveBeenCalled()

    const applyUpdate = onUpdateReady.mock.calls[0]![0] as () => void
    applyUpdate()
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })

    container.dispatchEvent(new Event('controllerchange'))
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not announce while the update is still installing', async () => {
    const { registration, onUpdateReady } = await setup()
    registration.findUpdate()
    expect(onUpdateReady).not.toHaveBeenCalled()
  })

  it('announces a worker that was already waiting, once', async () => {
    const waiting = new FakeWorker()
    waiting.state = 'installed'
    const { registration, onUpdateReady } = await setup({ waiting })
    expect(onUpdateReady).toHaveBeenCalledTimes(1)
    registration.findUpdate().moveTo('installed')
    expect(onUpdateReady).toHaveBeenCalledTimes(1)

    const applyUpdate = onUpdateReady.mock.calls[0]![0] as () => void
    applyUpdate()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('checks for updates every interval and when the tab becomes visible', async () => {
    vi.useFakeTimers()
    const { registration } = await setup()
    expect(registration.update).not.toHaveBeenCalled()

    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL)
    expect(registration.update).toHaveBeenCalledTimes(1)

    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    visibility.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).toHaveBeenCalledTimes(1)

    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).toHaveBeenCalledTimes(2)
  })

  it('ignores a failed update check', async () => {
    vi.useFakeTimers()
    const { registration } = await setup()
    registration.update.mockImplementation(() => Promise.reject(new Error('offline')))
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL)
    await Promise.resolve()
    expect(registration.update).toHaveBeenCalledTimes(1)
  })
})
