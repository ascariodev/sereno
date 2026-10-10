import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as registration from '../api/registration'
import { resetRegistrationStatus, useRegistrationStatus } from './useRegistrationStatus'

beforeEach(() => resetRegistrationStatus())
afterEach(() => vi.restoreAllMocks())

describe('useRegistrationStatus', () => {
  it('reports open', async () => {
    vi.spyOn(registration, 'registrationStatus').mockResolvedValue(true)
    const { enabled, ready } = useRegistrationStatus()
    expect(enabled.value).toBeNull()
    expect(await ready).toBe(true)
    expect(enabled.value).toBe(true)
  })

  it('reports closed', async () => {
    vi.spyOn(registration, 'registrationStatus').mockResolvedValue(false)
    const { enabled, ready } = useRegistrationStatus()
    await ready
    expect(enabled.value).toBe(false)
  })

  it('treats a failed request as closed and retries next time', async () => {
    const spy = vi.spyOn(registration, 'registrationStatus').mockRejectedValue(new Error('network'))
    const first = useRegistrationStatus()
    await first.ready
    expect(first.enabled.value).toBe(false)
    spy.mockResolvedValue(true)
    const second = useRegistrationStatus()
    await second.ready
    expect(second.enabled.value).toBe(true)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('ignores an in-flight request resolved after a reset', async () => {
    let resolveStale!: (value: boolean) => void
    const spy = vi
      .spyOn(registration, 'registrationStatus')
      .mockReturnValueOnce(new Promise<boolean>((resolve) => (resolveStale = resolve)))
      .mockResolvedValue(false)
    const stale = useRegistrationStatus()
    resetRegistrationStatus()
    resolveStale(true)
    await stale.ready
    const fresh = useRegistrationStatus()
    expect(fresh.enabled.value).toBeNull()
    expect(await fresh.ready).toBe(false)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('does not repeat the request once resolved or while in flight', async () => {
    const spy = vi.spyOn(registration, 'registrationStatus').mockResolvedValue(true)
    const a = useRegistrationStatus()
    const b = useRegistrationStatus()
    await Promise.all([a.ready, b.ready])
    const c = useRegistrationStatus()
    expect(c.enabled.value).toBe(true)
    await c.ready
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
