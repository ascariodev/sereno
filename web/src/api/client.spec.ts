import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from './client'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setup(response: Response) {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => response.clone())
  const client = createApiClient({ baseUrl: 'http://api.test/', fetch: fetchMock as never })
  return { client, fetchMock }
}

function call(fetchMock: ReturnType<typeof setup>['fetchMock'], index = 0) {
  const [url, init] = fetchMock.mock.calls[index]
  return { url, init, headers: init.headers as Record<string, string> }
}

describe('api client', () => {
  it('sends only Accept when nothing is configured', async () => {
    const { client, fetchMock } = setup(json({ data: [] }))

    await client.get('/api/me')

    const { url, headers } = call(fetchMock)
    expect(url).toBe('http://api.test/api/me')
    expect(headers).toEqual({ Accept: 'application/json' })
  })

  it('sends token, locale and organization from the providers', async () => {
    const { client, fetchMock } = setup(json({}))
    client.setTokenProvider(() => 'abc')
    client.setLocaleProvider(() => 'es')
    client.setOrganizationProvider(() => 7)

    await client.get('/api/projects', { query: { page: 2, skip: undefined } })

    const { url, headers } = call(fetchMock)
    expect(url).toBe('http://api.test/api/projects?page=2')
    expect(headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer abc',
      'Accept-Language': 'es',
      'X-Organization-Id': '7',
    })
  })

  it('omits headers whose provider returns nothing and reads providers on each request', async () => {
    const { client, fetchMock } = setup(json({}))
    let token: string | null = null
    client.setTokenProvider(() => token)
    client.setOrganizationProvider(() => null)

    await client.get('/api/me')
    token = 'later'
    await client.get('/api/me')

    expect(call(fetchMock, 0).headers).toEqual({ Accept: 'application/json' })
    expect(call(fetchMock, 1).headers).toMatchObject({ Authorization: 'Bearer later' })
    expect(call(fetchMock, 1).headers).not.toHaveProperty('X-Organization-Id')
  })

  it('serializes the body as JSON', async () => {
    const { client, fetchMock } = setup(json({ data: { id: 1 } }, 201))

    const result = await client.post('/api/channels/1/messages', { body: 'hi' })

    const { init, headers } = call(fetchMock)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"body":"hi"}')
    expect(headers['Content-Type']).toBe('application/json')
    expect(result).toEqual({ data: { id: 1 } })
  })

  it('normalizes a 422 with field errors', async () => {
    const { client } = setup(json({ message: 'Invalid.', errors: { email: ['Bad email.'] } }, 422))

    const error = await client.post('/api/auth/login', {}).catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 422,
      message: 'Invalid.',
      errors: { email: ['Bad email.'] },
    })
  })

  it('keeps status and message of other errors with empty field errors', async () => {
    const { client } = setup(json({ message: 'Forbidden.' }, 403))

    const error = await client.get('/api/projects').catch((e) => e)

    expect(error).toMatchObject({ status: 403, message: 'Forbidden.', errors: {} })
  })

  it('normalizes an error without JSON body', async () => {
    const { client } = setup(new Response('<html>', { status: 500, statusText: 'Server Error' }))

    const error = await client.get('/api/me').catch((e) => e)

    expect(error).toMatchObject({ status: 500, message: 'Server Error', errors: {} })
  })

  it('normalizes a 2xx response with an invalid JSON body as ApiError', async () => {
    const { client } = setup(new Response('<html>', { status: 200 }))

    const error = await client.get('/api/me').catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 200, errors: {} })
  })

  it('notifies the unauthorized handler on 401 and still throws', async () => {
    const { client } = setup(json({ message: 'Unauthenticated.' }, 401))
    const handler = vi.fn()
    client.setUnauthorizedHandler(handler)

    const error = await client.get('/api/me').catch((e) => e)

    expect(handler).toHaveBeenCalledOnce()
    expect(error).toMatchObject({ status: 401, message: 'Unauthenticated.' })
  })

  it('does not notify the handler on other errors', async () => {
    const { client } = setup(json({ message: 'Nope.' }, 403))
    const handler = vi.fn()
    client.setUnauthorizedHandler(handler)

    await client.get('/api/me').catch(() => undefined)

    expect(handler).not.toHaveBeenCalled()
  })

  it('returns undefined on 204 without a body', async () => {
    const { client } = setup(new Response(null, { status: 204 }))

    await expect(client.post('/api/auth/logout')).resolves.toBeUndefined()
  })

  it('turns network failures into ApiError with status 0', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const client = createApiClient({ baseUrl: 'http://api.test', fetch: fetchMock as never })

    const error = await client.get('/api/me').catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 0, message: 'Failed to fetch' })
  })
})
