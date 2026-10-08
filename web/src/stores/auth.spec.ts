import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import { getLocale } from '../i18n'
import { installAuthOnApi, TOKEN_STORAGE_KEY, useAuthStore } from './auth'

const user = { id: 1, name: 'Test', email: 'test@example.com', locale: 'es' }

describe('auth store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('login stores token, user and locale', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ token: 'abc', user })
    const auth = useAuthStore()
    await auth.login('test@example.com', 'password')
    expect(auth.token).toBe('abc')
    expect(auth.user).toEqual(user)
    expect(auth.isAuthenticated).toBe(true)
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('abc')
    expect(getLocale()).toBe('es')
  })

  it('a failed login leaves no session', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'bad', { email: ['x'] }))
    const auth = useAuthStore()
    await expect(auth.login('a', 'b')).rejects.toBeInstanceOf(ApiError)
    expect(auth.isAuthenticated).toBe(false)
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('fetchMe loads the user', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: user })
    const auth = useAuthStore()
    await auth.fetchMe()
    expect(auth.user).toEqual(user)
  })

  it('logout clears the session even if the API answers 401', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    setActivePinia(createPinia())
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(401, 'Unauthenticated'))
    const auth = useAuthStore()
    auth.user = user
    await auth.logout()
    expect(auth.token).toBeNull()
    expect(auth.user).toBeNull()
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(getLocale()).not.toBe('es')
  })

  it('a 401 from the client closes the session and notifies', () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    setActivePinia(createPinia())
    const handlerSpy = vi.spyOn(api, 'setUnauthorizedHandler')
    const expired = vi.fn()
    installAuthOnApi(expired)
    const handler = handlerSpy.mock.calls[0][0]!
    const auth = useAuthStore()
    expect(auth.token).toBe('abc')
    handler()
    expect(auth.token).toBeNull()
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(expired).toHaveBeenCalledOnce()
  })
})
