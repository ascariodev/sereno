import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { installAuthOnApi, TOKEN_STORAGE_KEY, useAuthStore } from '../stores/auth'
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

  it('resolves the project log route with its project id', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    vi.spyOn(api, 'get').mockResolvedValue({ data: user })
    const router = setup()
    await router.push('/projects/5/log?group=3')
    expect(router.currentRoute.value.name).toBe('project-log')
    expect(router.currentRoute.value.params.projectId).toBe('5')
    expect(router.currentRoute.value.query.group).toBe('3')
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

  describe('invite route', () => {
    const preview = { data: { organization: { name: 'Acme' }, email: 't@e.com', role: 'member', expires_at: '2026-10-15T00:00:00Z' } }

    it('opens without a session and does not redirect', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(preview)
      const router = setup()
      await router.push('/invite/abc')
      expect(router.currentRoute.value.name).toBe('invite')
      expect(router.currentRoute.value.params.token).toBe('abc')
    })

    it('opens with a session after loading the user', async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
      vi.spyOn(api, 'get').mockImplementation(async (path: string) => (path === '/api/me' ? { data: user } : preview))
      const router = setup()
      await router.push('/invite/abc')
      expect(router.currentRoute.value.name).toBe('invite')
      expect(useAuthStore().user).toEqual(user)
    })

    it('stays without a session when the stored token is invalid (401)', async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
      vi.spyOn(api, 'get').mockImplementation(async () => {
        useAuthStore().clearSession()
        throw new ApiError(401, 'Unauthenticated')
      })
      const router = setup()
      await router.push('/invite/abc')
      expect(router.currentRoute.value.name).toBe('invite')
      expect(useAuthStore().isAuthenticated).toBe(false)
    })

    describe('with the real 401 handler installed', () => {
      afterEach(() => {
        api.setUnauthorizedHandler(null)
        vi.unstubAllGlobals()
      })

      function setupWithHandler() {
        const router = setup()
        installAuthOnApi(() => redirectToLogin(router))
        vi.stubGlobal(
          'fetch',
          vi.fn(async (url: string) =>
            new URL(url).pathname === '/api/me'
              ? new Response(JSON.stringify({ message: 'Unauthenticated' }), { status: 401 })
              : new Response(JSON.stringify(preview), { status: 200, headers: { 'Content-Type': 'application/json' } }),
          ),
        )
        return router
      }

      it('an expired stored token leaves the user on the invitation without a session', async () => {
        localStorage.setItem(TOKEN_STORAGE_KEY, 'expired')
        const router = setupWithHandler()
        await router.push('/invite/abc')
        await new Promise((resolve) => setTimeout(resolve))
        expect(router.currentRoute.value.name).toBe('invite')
        expect(router.currentRoute.value.params.token).toBe('abc')
        expect(useAuthStore().isAuthenticated).toBe(false)
      })

      it('an expired stored token on a private deep link goes to login keeping the redirect', async () => {
        localStorage.setItem(TOKEN_STORAGE_KEY, 'expired')
        const router = setupWithHandler()
        await router.push('/channels/3')
        await new Promise((resolve) => setTimeout(resolve))
        expect(router.currentRoute.value.name).toBe('login')
        expect(router.currentRoute.value.query.redirect).toBe('/channels/3')
      })
    })

    it('goes to session-error keeping the invitation when fetchMe fails', async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
      vi.spyOn(api, 'get').mockRejectedValue(new ApiError(503, 'Unavailable'))
      const router = setup()
      await router.push('/invite/abc')
      expect(router.currentRoute.value.name).toBe('session-error')
      expect(router.currentRoute.value.query.redirect).toBe('/invite/abc')
    })
  })

  it('without token, login stays reachable', async () => {
    const router = setup()
    await router.push('/login')
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
