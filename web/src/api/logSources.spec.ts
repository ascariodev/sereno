import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogSource, listLogSources, revokeLogSource, rotateLogSourceKey } from './logSources'
import type { LogSource } from './types'

const source: LogSource = {
  id: 7,
  project_id: 3,
  name: 'posveapi',
  key_prefix: 'wsk_ab12',
  last_used_at: null,
  revoked_at: null,
  created_at: '2026-10-08T10:00:00.000000Z',
}

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('log sources client', () => {
  it('lists the sources of a project unwrapping data', async () => {
    const fetchMock = stubFetch({ data: [source] })

    const result = await listLogSources(3)

    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url).pathname).toBe('/api/projects/3/log-sources')
    expect(init?.method).toBe('GET')
    expect(result).toEqual([source])
  })

  it('creates a source posting the name and returns the plain key', async () => {
    const fetchMock = stubFetch({ data: { ...source, key: 'wsk_secret' } }, 201)

    const result = await createLogSource(3, 'posveapi')

    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url).pathname).toBe('/api/projects/3/log-sources')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ name: 'posveapi' })
    expect(result.key).toBe('wsk_secret')
  })

  it('rotates the key with a POST and returns the new key', async () => {
    const fetchMock = stubFetch({ data: { ...source, key: 'wsk_new' } })

    const result = await rotateLogSourceKey(3, 7)

    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url).pathname).toBe('/api/projects/3/log-sources/7/rotate-key')
    expect(init?.method).toBe('POST')
    expect(result.key).toBe('wsk_new')
  })

  it('revokes with a DELETE and unwraps the source', async () => {
    const revoked = { ...source, revoked_at: '2026-10-09T10:00:00.000000Z' }
    const fetchMock = stubFetch({ data: revoked })

    const result = await revokeLogSource(3, 7)

    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url).pathname).toBe('/api/projects/3/log-sources/7')
    expect(init?.method).toBe('DELETE')
    expect(result.revoked_at).toBe(revoked.revoked_at)
  })

  it('exposes 422 field errors when creating', async () => {
    stubFetch({ message: 'invalid', errors: { name: ['The name field is required.'] } }, 422)

    await expect(createLogSource(3, '')).rejects.toMatchObject({
      status: 422,
      errors: { name: ['The name field is required.'] },
    })
  })
})
