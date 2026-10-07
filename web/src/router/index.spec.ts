import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { TOKEN_STORAGE_KEY, useAuthStore } from '../stores/auth'
import { createAppRouter } from './index'
import { redirectToLogin } from './redirectToLogin'

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

  it('from the root without token goes to login without redirect', async () => {
    const router = setup()
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBeUndefined()
  })

  it('from the root with an invalid token (401) goes to login without redirect', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    vi.spyOn(api, 'get').mockImplementation(async () => {
      useAuthStore().clearSession()
      throw new ApiError(401, 'Unauthenticated')
    })
    const router = setup()
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBeUndefined()
  })

  it('session-error without token goes to login with its redirect, never to itself', async () => {
    const router = setup()
    await router.push('/session-error?redirect=/x')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/x')
  })

  it('session-error without token and with a root redirect adds none', async () => {
    const router = setup()
    await router.push('/session-error?redirect=/')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBeUndefined()
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

  describe('redirectToLogin', () => {
    async function routerAt(path: Parameters<ReturnType<typeof setup>['push']>[0]) {
      localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
      vi.spyOn(api, 'get').mockResolvedValue({ data: user })
      const router = setup()
      await router.push(path)
      useAuthStore().clearSession()
      return router
    }

    it('keeps the current route as redirect', async () => {
      const router = await routerAt('/channels/3')
      redirectToLogin(router)
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
      expect(router.currentRoute.value.query.redirect).toBe('/channels/3')
    })

    it('adds no redirect from the root', async () => {
      const router = await routerAt('/')
      redirectToLogin(router)
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
      expect(router.currentRoute.value.query.redirect).toBeUndefined()
    })

    it('from session-error reuses its redirect, never redirects to session-error', async () => {
      const router = await routerAt({ name: 'session-error', query: { redirect: '/channels/3' } })
      redirectToLogin(router)
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
      expect(router.currentRoute.value.query.redirect).toBe('/channels/3')
    })

    it('from session-error without redirect adds none', async () => {
      const router = await routerAt({ name: 'session-error' })
      redirectToLogin(router)
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
      expect(router.currentRoute.value.query.redirect).toBeUndefined()
    })

    it('does nothing when already on login', async () => {
      const router = await routerAt('/channels/3')
      redirectToLogin(router)
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
      const push = vi.spyOn(router, 'push')
      redirectToLogin(router)
      expect(push).not.toHaveBeenCalled()
      expect(router.currentRoute.value.query.redirect).toBe('/channels/3')
    })
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
