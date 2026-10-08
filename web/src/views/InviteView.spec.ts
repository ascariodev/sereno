import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { toast, toasts } from '../components/ui/toast'
import { i18n, setLocale } from '../i18n'
import { createAppRouter } from '../router'
import { TOKEN_STORAGE_KEY, useAuthStore } from '../stores/auth'
import { ORGANIZATION_STORAGE_KEY, useOrganizationStore } from '../stores/organization'

const user = { id: 1, name: 'Test', email: 'T@e.com', locale: 'en' }
const preview = { organization: { name: 'Acme' }, email: 't@e.com', role: 'admin', expires_at: '2026-10-15T12:00:00Z' }
const organizations = [
  { id: 1, name: 'Own', slug: 'own', roles: ['owner'] },
  { id: 7, name: 'Acme', slug: 'acme', roles: ['admin'] },
]

function mockGet(overrides: Record<string, () => unknown> = {}) {
  const routes: Record<string, () => unknown> = {
    '/api/me': () => ({ data: user }),
    '/api/invitations/tok': () => ({ data: preview }),
    '/api/organizations': () => ({ data: organizations }),
    ...overrides,
  }
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    const handler = routes[path]
    return handler ? handler() : { data: [] }
  })
}

async function mountInvite(path = '/invite/tok') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('InviteView', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    toast.clear()
    setLocale('en')
  })

  it('without a session shows the preview and no actions', async () => {
    mockGet()
    const { wrapper } = await mountInvite()
    expect(wrapper.find('h1').text()).toBe('You were invited to Acme')
    expect(wrapper.find('[data-test=email]').text()).toBe('t@e.com')
    expect(wrapper.find('[data-test=role]').text()).toBe('Admin')
    expect(wrapper.find('[data-test=accept]').exists()).toBe(false)
    expect(wrapper.find('[data-test=sign-out]').exists()).toBe(false)
  })

  it('with the same email accepts, selects the new organization and goes to projects', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    localStorage.setItem(ORGANIZATION_STORAGE_KEY, '1')
    mockGet()
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { organization_id: 7 } })
    const { wrapper, router } = await mountInvite()

    await wrapper.find('[data-test=accept]').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/api/invitations/accept', { token: 'tok' })
    expect(useOrganizationStore().activeId).toBe(7)
    expect(localStorage.getItem(ORGANIZATION_STORAGE_KEY)).toBe('7')
    expect(router.currentRoute.value.name).toBe('projects')
    expect(toasts.value.map((item) => item.message)).toContain('You joined Acme.')
  })

  it('keeps the new organization stored when reloading organizations fails after accepting', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    let organizationsFail = true
    mockGet({
      '/api/organizations': () => {
        if (organizationsFail) {
          organizationsFail = false
          throw new ApiError(503, 'Unavailable')
        }
        return { data: organizations }
      },
    })
    vi.spyOn(api, 'post').mockResolvedValue({ data: { organization_id: 7 } })
    const { wrapper, router } = await mountInvite()

    await wrapper.find('[data-test=accept]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('projects')
    expect(useOrganizationStore().activeId).toBe(7)
  })

  it('with another email says so and offers to sign out', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    mockGet({ '/api/me': () => ({ data: { ...user, email: 'other@e.com' } }) })
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined)
    const { wrapper, router } = await mountInvite()

    expect(wrapper.find('[data-test=accept]').exists()).toBe(false)
    expect(wrapper.find('[data-test=other-email]').text()).toContain('other@e.com')
    expect(wrapper.find('[data-test=other-email]').text()).toContain('t@e.com')

    await wrapper.find('[data-test=sign-out]').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/api/auth/logout')
    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(router.currentRoute.value.name).toBe('invite')
    expect(wrapper.find('h1').text()).toBe('You were invited to Acme')
    expect(wrapper.find('[data-test=sign-out]').exists()).toBe(false)
  })

  it('shows a message and a link home when the invitation is not usable', async () => {
    mockGet({
      '/api/invitations/tok': () => {
        throw new ApiError(404, 'The invitation is invalid or has expired.')
      },
    })
    const { wrapper } = await mountInvite()
    expect(wrapper.find('[data-test=unusable]').exists()).toBe(true)
    expect(wrapper.find('[data-test=home]').attributes('href')).toBe('/')
    expect(wrapper.find('[data-test=accept]').exists()).toBe(false)
  })

  it('shows the not usable message when accepting fails with 422', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    mockGet()
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'The invitation is invalid or has expired.'))
    const { wrapper, router } = await mountInvite()

    await wrapper.find('[data-test=accept]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test=unusable]').exists()).toBe(true)
    expect(wrapper.find('[data-test=accept]').exists()).toBe(false)
    expect(router.currentRoute.value.name).toBe('invite')
  })

  it('shows the wrong email error when accepting fails with 403', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    mockGet()
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(403, 'Forbidden'))
    const { wrapper } = await mountInvite()

    await wrapper.find('[data-test=accept]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test=accept-error]').text()).toBe(
      'This invitation was issued for a different email address.',
    )
    expect((wrapper.find('[data-test=accept]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('on a 401 when accepting asks to sign in again instead of a generic error', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    mockGet()
    vi.spyOn(api, 'post').mockImplementation(async () => {
      useAuthStore().clearSession()
      throw new ApiError(401, 'Unauthenticated')
    })
    const { wrapper, router } = await mountInvite()

    await wrapper.find('[data-test=accept]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test=session-expired]').text()).toBe(
      'Your session expired. Sign in again to accept the invitation.',
    )
    expect(wrapper.find('[data-test=accept-error]').exists()).toBe(false)
    expect(wrapper.find('[data-test=accept]').exists()).toBe(false)
    expect(wrapper.find('[data-test=sign-in]').attributes('href')).toBe(
      router.resolve({ name: 'login', query: { redirect: '/invite/tok' } }).href,
    )
  })

  it('discards a pending preview when the token changes', async () => {
    let resolveOld: (value: unknown) => void = () => {}
    const signals: Record<string, AbortSignal | undefined> = {}
    vi.spyOn(api, 'get').mockImplementation(async (path: string, opts?: { signal?: AbortSignal }) => {
      signals[path] = opts?.signal
      if (path === '/api/invitations/old') return new Promise((resolve) => (resolveOld = resolve))
      return { data: preview }
    })
    const { wrapper, router } = await mountInvite('/invite/old')
    expect(wrapper.find('[data-test=loading]').exists()).toBe(true)

    await router.push('/invite/tok')
    await flushPromises()
    resolveOld({ data: { ...preview, organization: { name: 'Old' } } })
    await flushPromises()

    expect(signals['/api/invitations/old']?.aborted).toBe(true)
    expect(wrapper.find('h1').text()).toBe('You were invited to Acme')
    expect(wrapper.find('[data-test=loading]').exists()).toBe(false)
  })

  it('discards a pending preview when unmounted', async () => {
    let rejectPreview: (error: unknown) => void = () => {}
    let signal: AbortSignal | undefined
    vi.spyOn(api, 'get').mockImplementation(async (_path: string, opts?: { signal?: AbortSignal }) => {
      signal = opts?.signal
      return new Promise((_resolve, reject) => (rejectPreview = reject))
    })
    const { wrapper } = await mountInvite()
    const inviteView = wrapper.findComponent({ name: 'InviteView' })
    expect(wrapper.find('[data-test=loading]').exists()).toBe(true)

    wrapper.unmount()
    rejectPreview(new ApiError(503, 'Unavailable'))
    await flushPromises()

    expect(signal?.aborted).toBe(true)
    expect((inviteView.vm as unknown as { loadError: string | null }).loadError).toBeNull()
  })

  it('offers to retry when the preview fails to load', async () => {
    let fail = true
    mockGet({
      '/api/invitations/tok': () => {
        if (fail) {
          fail = false
          throw new ApiError(503, 'Unavailable')
        }
        return { data: preview }
      },
    })
    const { wrapper } = await mountInvite()
    expect(wrapper.find('[data-test=load-failed]').exists()).toBe(true)

    await wrapper.find('[data-test=retry]').trigger('click')
    await flushPromises()

    expect(wrapper.find('h1').text()).toBe('You were invited to Acme')
  })
})
