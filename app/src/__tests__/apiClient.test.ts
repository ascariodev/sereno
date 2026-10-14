import { ApiError, createApiClient } from '@/api/client'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function setup(response: Response) {
  const fetchMock = jest.fn(async (_url: string, _init: RequestInit) => response.clone())
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

  it('sends token, locale and organization and builds the query', async () => {
    const { client, fetchMock } = setup(json({}))
    client.setTokenProvider(() => 'abc')
    client.setLocaleProvider(() => 'es')
    client.setOrganizationProvider(() => 7)

    await client.get('/api/projects', { query: { page: 2, skip: undefined, q: 'a b' } })

    const { url, headers } = call(fetchMock)
    expect(url).toBe('http://api.test/api/projects?page=2&q=a%20b')
    expect(headers).toMatchObject({
      Authorization: 'Bearer abc',
      'Accept-Language': 'es',
      'X-Organization-Id': '7',
    })
  })

  it('reads providers on each request and omits empty ones', async () => {
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

  it('returns undefined on 204', async () => {
    const { client } = setup(new Response(null, { status: 204 }))

    await expect(client.delete('/api/x/1')).resolves.toBeUndefined()
  })

  it('normalizes a 422 with field errors', async () => {
    const { client } = setup(json({ message: 'Invalid.', errors: { email: ['Bad email.'] } }, 422))

    const error = await client.post('/api/auth/login', {}).catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, message: 'Invalid.', errors: { email: ['Bad email.'] } })
  })

  it('normalizes an error without JSON body', async () => {
    const { client } = setup(new Response('<html>', { status: 500, statusText: 'Server Error' }))

    const error = await client.get('/api/me').catch((e) => e)

    expect(error).toMatchObject({ status: 500, message: 'Server Error', errors: {} })
  })

  it('normalizes a 2xx with an invalid JSON body', async () => {
    const { client } = setup(new Response('<html>', { status: 200 }))

    const error = await client.get('/api/me').catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 200, errors: {} })
  })

  it('wraps network failures as status 0', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetch: jest.fn(async () => {
        throw new TypeError('Network request failed')
      }) as never,
    })

    const error = await client.get('/api/me').catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 0, message: 'Network request failed' })
  })

  it('rethrows aborts untouched', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetch: jest.fn(async () => {
        throw abort
      }) as never,
    })

    await expect(client.get('/api/me')).rejects.toBe(abort)
  })

  it('notifies the unauthorized handler on 401 and still throws', async () => {
    const { client } = setup(json({ message: 'Unauthenticated.' }, 401))
    client.setTokenProvider(() => 'abc')
    const handler = jest.fn()
    client.setUnauthorizedHandler(handler)

    const error = await client.get('/api/me').catch((e) => e)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(error).toMatchObject({ status: 401 })
  })

  it('ignores a late 401 when the token changed in flight', async () => {
    let token = 'old'
    const fetchMock = jest.fn(async () => {
      token = 'new'
      return json({ message: 'Unauthenticated.' }, 401)
    })
    const client = createApiClient({ baseUrl: 'http://api.test', fetch: fetchMock as never })
    client.setTokenProvider(() => token)
    const handler = jest.fn()
    client.setUnauthorizedHandler(handler)

    await client.get('/api/me').catch(() => undefined)

    expect(handler).not.toHaveBeenCalled()
  })

  it('notifies the forbidden handler with the sent organization on organization_forbidden', async () => {
    const { client } = setup(json({ message: 'No.', code: 'organization_forbidden' }, 403))
    client.setOrganizationProvider(() => 5)
    const handler = jest.fn()
    client.setForbiddenHandler(handler)

    const error = await client.get('/api/projects').catch((e) => e)

    expect(handler).toHaveBeenCalledWith(5)
    expect(error).toMatchObject({ status: 403, code: 'organization_forbidden' })
  })

  it('does not notify on a plain 403, without organization, or after clearing the handler', async () => {
    const handler = jest.fn()

    const plain = setup(json({ message: 'No.' }, 403))
    plain.client.setOrganizationProvider(() => 5)
    plain.client.setForbiddenHandler(handler)
    await plain.client.get('/api/x').catch(() => undefined)

    const noOrg = setup(json({ message: 'No.', code: 'organization_forbidden' }, 403))
    noOrg.client.setForbiddenHandler(handler)
    await noOrg.client.get('/api/x').catch(() => undefined)

    const cleared = setup(json({ message: 'No.', code: 'organization_forbidden' }, 403))
    cleared.client.setOrganizationProvider(() => 5)
    cleared.client.setForbiddenHandler(handler)
    cleared.client.clearForbiddenHandler(handler)
    await cleared.client.get('/api/x').catch(() => undefined)

    expect(handler).not.toHaveBeenCalled()
  })
})
