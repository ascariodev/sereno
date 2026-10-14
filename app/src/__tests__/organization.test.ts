import * as SecureStore from 'expo-secure-store'

import { api } from '@/api/client'
import { installOrganizationOnApi, useOrganizationStore } from '@/organization/store'
import { ORGANIZATION_STORAGE_KEY } from '@/session/storage'

jest.mock('expo-secure-store', () => {
  const data = new Map<string, string>()
  return {
    __data: data,
    getItemAsync: jest.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void data.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void data.delete(key)),
  }
})

const stored = (SecureStore as unknown as { __data: Map<string, string> }).__data
const acme = { id: 7, name: 'Acme', slug: 'acme', roles: ['owner'] }
const beta = { id: 8, name: 'Beta', slug: 'beta', roles: ['member'] }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

function mockFetch(handler: Handler) {
  const fn = jest.fn(async (url: string, init: RequestInit) => handler(url, init))
  globalThis.fetch = fn as never
  return fn
}

const state = () => useOrganizationStore.getState()

beforeEach(() => {
  stored.clear()
  state().clear()
  api.setTokenProvider(null)
  installOrganizationOnApi()
  mockFetch(() => json({ data: [acme, beta] }))
})

describe('load', () => {
  it('lists the organizations and activates and remembers the first when nothing was remembered', async () => {
    await state().load()

    expect(state().organizations).toEqual([acme, beta])
    expect(state().loaded).toBe(true)
    expect(state().activeId).toBe(7)
    expect(stored.get(ORGANIZATION_STORAGE_KEY)).toBe('7')
  })

  it('selects nothing when there are no organizations', async () => {
    mockFetch(() => json({ data: [] }))

    await state().load()

    expect(state().loaded).toBe(true)
    expect(state().activeId).toBeNull()
  })

  it('recovers the remembered organization', async () => {
    stored.set(ORGANIZATION_STORAGE_KEY, '8')

    await state().load()

    expect(state().activeId).toBe(8)
    expect(state().active()).toEqual(beta)
  })

  it('falls back to the first organization when the remembered one is no longer listed', async () => {
    stored.set(ORGANIZATION_STORAGE_KEY, '99')

    await state().load()

    expect(state().activeId).toBe(7)
    expect(stored.get(ORGANIZATION_STORAGE_KEY)).toBe('7')
  })

  it('ignores a garbage remembered value', async () => {
    stored.set(ORGANIZATION_STORAGE_KEY, 'abc')

    await state().load()

    expect(state().activeId).toBe(7)
  })

  it('keeps the active organization on a reload', async () => {
    await state().load()
    await state().select(8)

    await state().load()

    expect(state().activeId).toBe(8)
  })

  it('still activates the first organization when remembering it fails', async () => {
    ;(SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('disk'))

    await state().load()

    expect(state().activeId).toBe(7)
  })

  it('flags a failed load and recovers on retry', async () => {
    mockFetch(() => json({ message: 'boom' }, 500))
    await state().load()
    expect(state().loadError).toBe(true)
    expect(state().loaded).toBe(false)

    mockFetch(() => json({ data: [acme] }))
    await state().load()
    expect(state().loadError).toBe(false)
    expect(state().loaded).toBe(true)
  })

  it('discards a response that arrives after clear()', async () => {
    let release: (response: Response) => void = () => {}
    mockFetch(() => new Promise<Response>((resolve) => (release = resolve)))
    const pending = state().load()

    state().clear()
    release(json({ data: [acme] }))
    await pending

    expect(state().organizations).toEqual([])
    expect(state().loaded).toBe(false)
  })

  it('discards an older response when a newer load started', async () => {
    const releases: ((response: Response) => void)[] = []
    mockFetch(() => new Promise<Response>((resolve) => releases.push(resolve)))
    const first = state().load()
    const second = state().load()

    releases[1](json({ data: [beta] }))
    await second
    releases[0](json({ data: [acme] }))
    await first

    expect(state().organizations).toEqual([beta])
  })
})

describe('select', () => {
  it('activates a listed organization and remembers it', async () => {
    await state().load()

    await state().select(8)

    expect(state().activeId).toBe(8)
    expect(stored.get(ORGANIZATION_STORAGE_KEY)).toBe('8')
  })

  it('ignores an organization that is not listed', async () => {
    await state().load()

    await state().select(99)

    expect(state().activeId).toBe(7)
    expect(stored.get(ORGANIZATION_STORAGE_KEY)).toBe('7')
  })

  it('keeps the choice for this run when saving fails', async () => {
    await state().load()
    ;(SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('disk'))

    await expect(state().select(8)).resolves.toBeUndefined()

    expect(state().activeId).toBe(8)
  })

  it('sends the active organization in the X-Organization-Id header', async () => {
    await state().load()
    await state().select(8)
    const fn = mockFetch(() => json({}))

    await api.get('/api/projects')

    expect((fn.mock.calls[0][1].headers as Record<string, string>)['X-Organization-Id']).toBe('8')
  })
})

describe('create', () => {
  it('creates, reloads and activates the new organization', async () => {
    const created = { id: 9, name: 'Gamma', slug: 'gamma' }
    const fn = mockFetch((url, init) =>
      init.method === 'POST' ? json({ data: created }, 201) : json({ data: [acme, { ...created, roles: ['owner'] }] }),
    )

    const result = await state().create('Gamma')

    expect(result).toEqual(created)
    expect(JSON.parse(fn.mock.calls[0][1].body as string)).toEqual({ name: 'Gamma' })
    expect(state().activeId).toBe(9)
    expect(state().organizations.map((o) => o.id)).toEqual([7, 9])
    expect(stored.get(ORGANIZATION_STORAGE_KEY)).toBe('9')
  })

  it('still activates the organization when the reload fails', async () => {
    const created = { id: 9, name: 'Gamma', slug: 'gamma' }
    mockFetch((url, init) => (init.method === 'POST' ? json({ data: created }, 201) : json({}, 500)))

    await state().create('Gamma')

    expect(state().activeId).toBe(9)
    expect(state().organizations).toEqual([created])
  })

  it('does not activate anything when clear() happens during the request', async () => {
    let release: (response: Response) => void = () => {}
    mockFetch(() => new Promise<Response>((resolve) => (release = resolve)))
    const pending = state().create('Gamma')

    state().clear()
    release(json({ data: { id: 9, name: 'Gamma', slug: 'gamma' } }, 201))
    await pending

    expect(state().activeId).toBeNull()
    expect(stored.has(ORGANIZATION_STORAGE_KEY)).toBe(false)
  })

  it('rethrows validation errors', async () => {
    mockFetch(() => json({ message: 'invalid', errors: { name: ['Required'] } }, 422))

    await expect(state().create('')).rejects.toMatchObject({ status: 422 })
  })
})

describe('403 organization_forbidden', () => {
  const forbidden = () => json({ message: 'no', code: 'organization_forbidden' }, 403)

  it('moves to the first available organization when the active one is no longer listed', async () => {
    await state().load()
    await state().select(7)
    mockFetch((url) => (url.endsWith('/api/organizations') ? json({ data: [beta] }) : forbidden()))

    await expect(api.get('/api/projects')).rejects.toMatchObject({ status: 403 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state().activeId).toBe(8)
    expect(state().organizations).toEqual([beta])
    expect(stored.get(ORGANIZATION_STORAGE_KEY)).toBe('8')
  })

  it('goes back to the selector when no organization is left', async () => {
    await state().load()
    await state().select(7)
    mockFetch((url) => (url.endsWith('/api/organizations') ? json({ data: [] }) : forbidden()))

    await expect(api.get('/api/projects')).rejects.toMatchObject({ status: 403 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state().activeId).toBeNull()
    expect(stored.has(ORGANIZATION_STORAGE_KEY)).toBe(false)
  })

  it('keeps the organization when it is still listed', async () => {
    await state().load()
    await state().select(7)
    mockFetch((url) => (url.endsWith('/api/organizations') ? json({ data: [acme, beta] }) : forbidden()))

    await expect(api.get('/api/projects')).rejects.toMatchObject({ status: 403 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(state().activeId).toBe(7)
  })

  it('ignores a 403 for an organization that is not the active one', async () => {
    await state().load()
    await state().select(7)
    const fn = mockFetch(() => json({}))

    await state().handleForbidden(8)

    expect(fn).not.toHaveBeenCalled()
    expect(state().activeId).toBe(7)
  })
})

it('clear resets everything but keeps the remembered choice on disk', async () => {
  await state().load()
  await state().select(7)

  state().clear()

  expect(state()).toMatchObject({ organizations: [], activeId: null, loaded: false, loadError: false })
  expect(stored.get(ORGANIZATION_STORAGE_KEY)).toBe('7')
})
