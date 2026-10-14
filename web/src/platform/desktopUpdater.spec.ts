import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const check = vi.hoisted(() => vi.fn())
const relaunch = vi.hoisted(() => vi.fn())
const toastState = vi.hoisted(() => ({ items: [] as { id: number; open: boolean }[], nextId: 0 }))
const toastInfo = vi.hoisted(() =>
  vi.fn((_message: string, _options: { duration: number; action: { label: string; onSelect: () => void } }) => {
    const id = ++toastState.nextId
    toastState.items.push({ id, open: true })
    return id
  }),
)
const toastError = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/plugin-updater', () => ({ check }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }))
vi.mock('../components/ui/toast', () => ({ toast: { info: toastInfo, error: toastError }, toasts: { get value() { return toastState.items } } }))

function fakeUpdate() {
  return {
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

async function load() {
  vi.resetModules()
  return import('./desktopUpdater')
}

describe('desktopUpdater', () => {
  let stop: () => void = () => {}

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('isTauri', true)
    check.mockReset().mockResolvedValue(null)
    relaunch.mockReset().mockResolvedValue(undefined)
    toastInfo.mockClear()
    toastState.items = []
    toastError.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    stop()
    stop = () => {}
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does nothing in the browser', async () => {
    vi.stubGlobal('isTauri', false)
    const { installDesktopUpdater, UPDATE_CHECK_INTERVAL } = await load()

    stop = installDesktopUpdater()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL * 2)

    expect(check).not.toHaveBeenCalled()
  })

  it('checks at startup and again every interval, without a toast when there is no new version', async () => {
    const { installDesktopUpdater, UPDATE_CHECK_INTERVAL } = await load()

    stop = installDesktopUpdater()
    await vi.advanceTimersByTimeAsync(0)
    expect(check).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL)
    expect(check).toHaveBeenCalledTimes(2)
    expect(toastInfo).not.toHaveBeenCalled()
  })

  it('downloads a new version and offers a restart that installs and relaunches', async () => {
    const update = fakeUpdate()
    check.mockResolvedValue(update)
    const { checkForUpdate } = await load()

    await checkForUpdate()

    expect(update.download).toHaveBeenCalledTimes(1)
    expect(update.install).not.toHaveBeenCalled()
    expect(toastInfo).toHaveBeenCalledTimes(1)
    const [message, options] = toastInfo.mock.calls[0]!
    expect(message).toBe('A new version of Sereno is ready. Restart to install it.')
    expect(options.duration).toBe(Number.POSITIVE_INFINITY)
    expect(options.action.label).toBe('Restart')

    options.action.onSelect()
    await vi.waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1))
    expect(update.install).toHaveBeenCalledTimes(1)
    expect(update.install.mock.invocationCallOrder[0]).toBeLessThan(relaunch.mock.invocationCallOrder[0]!)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('stays silent on a network error and tries again later', async () => {
    check.mockRejectedValue(new Error('network'))
    const { installDesktopUpdater, UPDATE_CHECK_INTERVAL } = await load()

    stop = installDesktopUpdater()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL)

    expect(check).toHaveBeenCalledTimes(2)
    expect(toastInfo).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('stays silent and closes the update when the download fails', async () => {
    const update = fakeUpdate()
    update.download.mockRejectedValue(new Error('network'))
    check.mockResolvedValue(update)
    const { checkForUpdate } = await load()

    await checkForUpdate()

    expect(update.close).toHaveBeenCalledTimes(1)
    expect(toastInfo).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('does not start a second check while one is in progress', async () => {
    let resolveCheck: (value: null) => void = () => {}
    check.mockReturnValue(new Promise((resolve) => (resolveCheck = resolve)))
    const { checkForUpdate } = await load()

    const first = checkForUpdate()
    await checkForUpdate()
    expect(check).toHaveBeenCalledTimes(1)

    resolveCheck(null)
    await first
    await checkForUpdate()
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('does not check again while a downloaded update waits for the restart', async () => {
    check.mockResolvedValue(fakeUpdate())
    const { installDesktopUpdater, UPDATE_CHECK_INTERVAL } = await load()

    stop = installDesktopUpdater()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL * 2)

    expect(check).toHaveBeenCalledTimes(1)
    expect(toastInfo).toHaveBeenCalledTimes(1)
  })

  it('shows an error and allows a new check when the install fails', async () => {
    const update = fakeUpdate()
    update.install.mockRejectedValue(new Error('installer'))
    check.mockResolvedValue(update)
    const { checkForUpdate } = await load()

    await checkForUpdate()
    toastInfo.mock.calls[0]![1].action.onSelect()
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not install the new version of Sereno.'))
    expect(relaunch).not.toHaveBeenCalled()

    await checkForUpdate()
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('offers the downloaded update again on the next cycle after the toast is closed, without downloading again', async () => {
    const update = fakeUpdate()
    check.mockResolvedValue(update)
    const { installDesktopUpdater, UPDATE_CHECK_INTERVAL } = await load()

    stop = installDesktopUpdater()
    await vi.advanceTimersByTimeAsync(0)
    expect(toastInfo).toHaveBeenCalledTimes(1)

    toastState.items[0]!.open = false
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL)

    expect(toastInfo).toHaveBeenCalledTimes(2)
    expect(check).toHaveBeenCalledTimes(1)
    expect(update.download).toHaveBeenCalledTimes(1)
    toastInfo.mock.calls[1]![1].action.onSelect()
    await vi.waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1))
    expect(update.install).toHaveBeenCalledTimes(1)
  })

  it('does not duplicate the toast while it is still open', async () => {
    check.mockResolvedValue(fakeUpdate())
    const { installDesktopUpdater, UPDATE_CHECK_INTERVAL } = await load()

    stop = installDesktopUpdater()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL * 2)

    expect(toastInfo).toHaveBeenCalledTimes(1)
  })
})
