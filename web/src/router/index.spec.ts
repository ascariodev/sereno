import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { TOKEN_STORAGE_KEY, useAuthStore } from '../stores/auth'
import { createAppRouter } from './index'

const user = { id: 1, name: 'Test', email: 't@e.com', locale: 'en' }

function setup() {
  setActivePinia(createPinia())
  return createAppRouter(createMemoryHistory())
}

describe('router guard', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('without token redirects to login', async () => {
    const router = setup()
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('with token loads the user and enters', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: user })
    const router = setup()
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('projects')
    expect(get).toHaveBeenCalledOnce()
    expect(useAuthStore().user).toEqual(user)
  })

  it('with token, login redirects to projects', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    vi.spyOn(api, 'get').mockResolvedValue({ data: user })
    const router = setup()
    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('projects')
  })

  it('an invalid token (401 clears the session) redirects to login', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    const router = setup()
    const auth = useAuthStore()
    vi.spyOn(api, 'get').mockImplementation(async () => {
      auth.clearSession()
      throw new ApiError(401, 'Unauthenticated')
    })
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('login')
  })

  it.each([
    ['5xx', new ApiError(503, 'Unavailable')],
    ['no network', new ApiError(0, 'Network')],
  ])('fetchMe failing with %s goes to session-error and keeps the token', async (_label, error) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    vi.spyOn(api, 'get').mockRejectedValue(error)
    const router = setup()
    await router.push('/channels/3')
    expect(router.currentRoute.value.name).toBe('session-error')
    expect(router.currentRoute.value.query.redirect).toBe('/channels/3')
    expect(useAuthStore().token).toBe('abc')
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('abc')
  })
})
