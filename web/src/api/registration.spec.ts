import { afterEach, describe, expect, it, vi } from 'vitest'
import { registrationStatus } from './registration'

afterEach(() => vi.unstubAllGlobals())

describe('registrationStatus', () => {
  it('reads the public flag', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ enabled: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await registrationStatus()).toBe(false)
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/auth/registration')
  })
})
