import * as SecureStore from 'expo-secure-store'

import { api, ApiError } from '@/api/client'
import { getLocale, setChosenLocale, setLocale } from '@/i18n'
import { installAuthOnApi, useAuthStore } from '@/session/auth'
import { LOCALE_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/session/storage'

jest.mock('expo-secure-store', () => {
  const data = new Map<string, string>()
  return {
    __data: data,
    getItemAsync: jest.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void data.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void data.delete(key)),
  }
})
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }))
jest.mock('expo-device', () => ({ deviceName: 'Pixel de Sergio', modelName: 'Pixel 8' }))

const store = (SecureStore as unknown as { __data: Map<string, string> }).__data
const user = { id: 1, name: 'Ana', email: 'ana@example.com', locale: 'es' }

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = jest.fn(async (url: string, init: RequestInit) => handler(url, init))
  globalThis.fetch = fn as never
  return fn
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(async () => {
  store.clear()
  mockFetch(() => json({}))
  api.setTokenProvider(null)
  api.setUnauthorizedHandler(null)
  await useAuthStore.getState().clearSession()
  useAuthStore.setState({ hydrated: false })
  setChosenLocale(null)
  setLocale(null)
  installAuthOnApi()
})

describe('auth store', () => {
  it('login stores the token, sends device_name and applies the account locale', async () => {
    const fetchMock = mockFetch(() => json({ token: 'tk', user }))

    await useAuthStore.getState().login('ana@example.com', 'secret')

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      email: 'ana@example.com',
      password: 'secret',
      device_name: 'Pixel de Sergio',
    })
    expect(useAuthStore.getState()).toMatchObject({ token: 'tk', user })
    expect(store.get(TOKEN_STORAGE_KEY)).toBe('tk')
    expect(getLocale()).toBe('es')
  })

  it('hydrate restores the token and the chosen locale', async () => {
    store.set(TOKEN_STORAGE_KEY, 'saved')
    store.set(LOCALE_STORAGE_KEY, 'es')

    await useAuthStore.getState().hydrate()

    expect(useAuthStore.getState()).toMatchObject({ token: 'saved', hydrated: true })
    expect(getLocale()).toBe('es')
  })

  it('sends the stored token as Bearer', async () => {
    store.set(TOKEN_STORAGE_KEY, 'saved')
    await useAuthStore.getState().hydrate()
    const fetchMock = mockFetch(() => json({ data: user }))

    await useAuthStore.getState().fetchMe()

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer saved')
    expect(useAuthStore.getState().user).toEqual(user)
    expect(getLocale()).toBe('es')
  })

  it('logout clears the token even when the API call fails', async () => {
    mockFetch(() => json({ token: 'tk', user }))
    await useAuthStore.getState().login('a@b.c', 'x')
    mockFetch(() => json({ message: 'boom' }, 500))

    await useAuthStore.getState().logout()

    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null })
    expect(store.has(TOKEN_STORAGE_KEY)).toBe(false)
  })

  it('a 401 closes the session and notifies', async () => {
    mockFetch(() => json({ token: 'tk', user }))
    await useAuthStore.getState().login('a@b.c', 'x')
    const expired = jest.fn()
    installAuthOnApi(expired)
    mockFetch(() => json({ message: 'Unauthenticated.' }, 401))

    await expect(useAuthStore.getState().fetchMe()).rejects.toBeInstanceOf(ApiError)

    expect(useAuthStore.getState().token).toBeNull()
    expect(expired).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(store.has(TOKEN_STORAGE_KEY)).toBe(false)
  })

  it('discards a fetchMe response that arrives after logout', async () => {
    mockFetch(() => json({ token: 'tk', user }))
    await useAuthStore.getState().login('a@b.c', 'x')
    let release!: (response: Response) => void
    mockFetch(() => new Promise<Response>((resolve) => (release = resolve)))

    const pending = useAuthStore.getState().fetchMe()
    await useAuthStore.getState().clearSession()
    release(json({ data: user }))
    await pending

    expect(useAuthStore.getState().user).toBeNull()
  })

  it('a manual language choice is saved on the account and persisted', async () => {
    mockFetch(() => json({ token: 'tk', user: { ...user, locale: null } }))
    await useAuthStore.getState().login('a@b.c', 'x')
    const fetchMock = mockFetch(() => json({ data: { ...user, locale: 'es' } }))

    const saved = await useAuthStore.getState().chooseAndSaveLocale('es')

    expect(saved).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toContain('/api/me/locale')
    expect(store.get(LOCALE_STORAGE_KEY)).toBe('es')
    expect(getLocale()).toBe('es')
    expect(useAuthStore.getState().user?.locale).toBe('es')
  })

  it('returns false when saving the language fails with an API error', async () => {
    mockFetch(() => json({ message: 'no' }, 500))

    expect(await useAuthStore.getState().chooseAndSaveLocale('es')).toBe(false)
    expect(store.get(LOCALE_STORAGE_KEY)).toBe('es')
  })

  it('login with an explicit locale saves it on the account and persists it', async () => {
    let call = 0
    mockFetch(() => (call++ === 0 ? json({ token: 'tk', user: { ...user, locale: null } }) : json({ data: { ...user, locale: 'es' } })))

    const saved = await useAuthStore.getState().login('a@b.c', 'x', 'es')

    expect(saved).toBe(true)
    expect(store.get(LOCALE_STORAGE_KEY)).toBe('es')
    expect(getLocale()).toBe('es')
    expect(useAuthStore.getState().user?.locale).toBe('es')
  })

  it('a clearSession during the token write removes what was written', async () => {
    mockFetch(() => json({ token: 'tk', user }))
    const setItem = SecureStore.setItemAsync as jest.Mock
    let finish!: () => void
    setItem.mockImplementationOnce(
      (key: string, value: string) =>
        new Promise<void>((resolve) => {
          finish = () => {
            store.set(key, value)
            resolve()
          }
        }),
    )

    const pending = useAuthStore.getState().login('a@b.c', 'x')
    await new Promise((resolve) => setImmediate(() => resolve(undefined)))
    await useAuthStore.getState().clearSession()
    finish()
    await pending

    expect(useAuthStore.getState().token).toBeNull()
    expect(store.has(TOKEN_STORAGE_KEY)).toBe(false)
  })

  it('hydrate displaced by a login still marks hydrated and loads the chosen locale', async () => {
    store.set(TOKEN_STORAGE_KEY, 'old')
    store.set(LOCALE_STORAGE_KEY, 'es')
    mockFetch(() => json({ token: 'new', user: { ...user, locale: 'en' } }))

    const hydrating = useAuthStore.getState().hydrate()
    await useAuthStore.getState().login('a@b.c', 'x')
    await hydrating

    expect(useAuthStore.getState()).toMatchObject({ token: 'new', hydrated: true })
  })

  it('a failed token write undoes the session and rethrows', async () => {
    mockFetch(() => json({ token: 'tk', user }))
    ;(SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keystore'))

    await expect(useAuthStore.getState().login('a@b.c', 'x')).rejects.toThrow('keystore')

    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null })
    expect(store.has(TOKEN_STORAGE_KEY)).toBe(false)
  })

  it('a failed token write of an older login keeps the token of a newer login', async () => {
    let call = 0
    mockFetch(() => json({ token: call++ === 0 ? 'old' : 'new', user }))
    let fail!: () => void
    ;(SecureStore.setItemAsync as jest.Mock).mockImplementationOnce(
      () => new Promise<void>((_, reject) => (fail = () => reject(new Error('keystore')))),
    )

    const first = useAuthStore.getState().login('a@b.c', 'x')
    await new Promise((resolve) => setImmediate(() => resolve(undefined)))
    await useAuthStore.getState().login('a@b.c', 'x')
    fail()
    await expect(first).rejects.toThrow('keystore')

    expect(useAuthStore.getState().token).toBe('new')
    expect(store.get(TOKEN_STORAGE_KEY)).toBe('new')
  })

  it('a failed locale write still applies and saves the choice', async () => {
    ;(SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keystore'))
    mockFetch(() => json({ data: { ...user, locale: 'es' } }))

    await expect(useAuthStore.getState().chooseAndSaveLocale('es')).resolves.toBe(true)
    expect(getLocale()).toBe('es')
  })

  it('the persisted manual choice wins after a restart when the account has no locale', async () => {
    store.set(TOKEN_STORAGE_KEY, 'saved')
    store.set(LOCALE_STORAGE_KEY, 'es')
    await useAuthStore.getState().hydrate()
    mockFetch(() => json({ data: { ...user, locale: null } }))

    await useAuthStore.getState().fetchMe()

    expect(getLocale()).toBe('es')
  })
})
