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

  describe('creating an account from the invitation', () => {
    const registered = { token: 'new-token', user: { ...user, email: 't@e.com' } }

    async function fill(wrapper: Awaited<ReturnType<typeof mountInvite>>['wrapper']) {
      await wrapper.find('#invite-name').setValue('New Person')
      await wrapper.find('#invite-password').setValue('secret-pass-1')
      await wrapper.find('#invite-password-confirmation').setValue('secret-pass-1')
      await wrapper.find('[data-test=register-form]').trigger('submit')
      await flushPromises()
    }

    it('shows the form with the fixed email and a link to sign in that returns here', async () => {
      mockGet()
      const { wrapper, router } = await mountInvite()

      expect((wrapper.find('#invite-email').element as HTMLInputElement).value).toBe('t@e.com')
      expect(wrapper.find('#invite-email').attributes('readonly')).toBeDefined()
      expect(wrapper.find('[data-test=sign-in-instead]').attributes('href')).toBe(
        router.resolve({ name: 'login', query: { redirect: '/invite/tok' } }).href,
      )
    })

    it('registers and then accepts, selects the organization and goes to projects', async () => {
      mockGet()
      const post = vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
        if (path === '/api/auth/register') return registered
        return { data: { organization_id: 7 } }
      })
      const { wrapper, router } = await mountInvite()

      await fill(wrapper)

      expect(post.mock.calls).toEqual([
        [
          '/api/auth/register',
          { name: 'New Person', email: 't@e.com', password: 'secret-pass-1', password_confirmation: 'secret-pass-1' },
        ],
        ['/api/invitations/accept', { token: 'tok' }],
      ])
      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('new-token')
      expect(useOrganizationStore().activeId).toBe(7)
      expect(router.currentRoute.value.name).toBe('projects')
      expect(toasts.value.map((item) => item.message)).toContain('You joined Acme.')
    })

    it('shows 422 errors per field and does not accept', async () => {
      mockGet()
      const post = vi
        .spyOn(api, 'post')
        .mockRejectedValue(
          new ApiError(422, 'invalid', { name: ['Name is required'], password: ['Too short'], email: ['Taken'] }),
        )
      const { wrapper } = await mountInvite()

      await fill(wrapper)

      expect(post).toHaveBeenCalledTimes(1)
      expect(wrapper.find('[data-test=error-name]').text()).toBe('Name is required')
      expect(wrapper.find('[data-test=error-password]').text()).toBe('Too short')
      expect(wrapper.find('[data-test=error-email]').text()).toBe('Taken')
      expect(wrapper.find('#invite-name').attributes('aria-invalid')).toBe('true')
      expect(wrapper.find('#invite-password').attributes('aria-describedby')).toBe('invite-password-error-0')
      expect(useAuthStore().isAuthenticated).toBe(false)
    })

    it('points to the sign in link when the email is already registered', async () => {
      mockGet()
      vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid', { email: ['Taken'] }))
      const { wrapper } = await mountInvite()

      expect(wrapper.find('[data-test=email-taken-hint]').exists()).toBe(false)
      expect(wrapper.find('#invite-email').attributes('aria-invalid')).toBeUndefined()

      await fill(wrapper)

      expect(wrapper.find('[data-test=error-email]').text()).toBe('Taken')
      expect(wrapper.find('#invite-email').attributes('aria-invalid')).toBe('true')
      expect(wrapper.find('#invite-email').attributes('aria-describedby')).toBe(
        'invite-email-error-0 invite-email-hint',
      )
      expect(wrapper.find('#invite-email-error-0').text()).toBe('Taken')
      expect(wrapper.find('#invite-email-hint').exists()).toBe(true)
      expect(wrapper.find('[data-test=email-taken-hint]').text()).toContain('already has an account')
      expect(wrapper.findAll('[data-test=sign-in-instead]')).toHaveLength(1)
    })

    it('does not show the sign in hint for other field errors', async () => {
      mockGet()
      vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid', { name: ['Name is required'] }))
      const { wrapper } = await mountInvite()

      await fill(wrapper)

      expect(wrapper.find('[data-test=email-taken-hint]').exists()).toBe(false)
    })

    it('clears both passwords after a 422 on the password', async () => {
      mockGet()
      vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid', { password: ['Too short'] }))
      const { wrapper } = await mountInvite()

      await fill(wrapper)

      expect((wrapper.find('#invite-password').element as HTMLInputElement).value).toBe('')
      expect((wrapper.find('#invite-password-confirmation').element as HTMLInputElement).value).toBe('')
      expect((wrapper.find('#invite-name').element as HTMLInputElement).value).toBe('New Person')
    })

    it('does not accept when unmounted while registering', async () => {
      mockGet()
      let resolveRegister: (value: unknown) => void = () => {}
      const post = vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
        if (path === '/api/auth/register') return new Promise((resolve) => (resolveRegister = resolve))
        return { data: { organization_id: 7 } }
      })
      const { wrapper } = await mountInvite()
      const inviteView = wrapper.findComponent({ name: 'InviteView' })

      await fill(wrapper)
      wrapper.unmount()
      resolveRegister(registered)
      await flushPromises()

      expect(post).toHaveBeenCalledTimes(1)
      expect((inviteView.vm as unknown as { registered: boolean }).registered).toBe(false)
      expect(useOrganizationStore().activeId).toBeNull()
    })

    it('does not accept the new token when the token changes while registering', async () => {
      mockGet({ '/api/invitations/other': () => ({ data: { ...preview, organization: { name: 'Other' } } }) })
      let resolveRegister: (value: unknown) => void = () => {}
      const post = vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
        if (path === '/api/auth/register') return new Promise((resolve) => (resolveRegister = resolve))
        return { data: { organization_id: 7 } }
      })
      const { wrapper, router } = await mountInvite()
      const inviteView = wrapper.findComponent({ name: 'InviteView' })

      await fill(wrapper)
      await router.push('/invite/other')
      await flushPromises()
      resolveRegister(registered)
      await flushPromises()

      expect(post).toHaveBeenCalledTimes(1)
      expect((inviteView.vm as unknown as { registered: boolean }).registered).toBe(false)
      expect(router.currentRoute.value.name).not.toBe('projects')
    })

    it('shows a message on throttling', async () => {
      mockGet()
      vi.spyOn(api, 'post').mockRejectedValue(new ApiError(429, 'Too Many Attempts.'))
      const { wrapper } = await mountInvite()

      await fill(wrapper)

      expect(wrapper.find('[data-test=error-form]').text()).toBe('Too many attempts. Try again in a minute.')
    })

    it('reports the created account and allows retrying when accepting fails', async () => {
      mockGet()
      let acceptFails = true
      const post = vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
        if (path === '/api/auth/register') return registered
        if (acceptFails) {
          acceptFails = false
          throw new ApiError(503, 'Unavailable')
        }
        return { data: { organization_id: 7 } }
      })
      const { wrapper, router } = await mountInvite()

      await fill(wrapper)

      expect(useAuthStore().isAuthenticated).toBe(true)
      expect(wrapper.find('[data-test=registered-not-joined]').text()).toBe(
        'Your account was created, but you have not joined the organization yet.',
      )
      expect(wrapper.find('[data-test=accept-error]').exists()).toBe(true)
      expect(wrapper.find('[data-test=register-form]').exists()).toBe(false)

      await wrapper.find('[data-test=accept]').trigger('click')
      await flushPromises()

      expect(post).toHaveBeenCalledTimes(3)
      expect(router.currentRoute.value.name).toBe('projects')
    })

    it('reports the created account when the invitation turns out not usable', async () => {
      mockGet()
      vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
        if (path === '/api/auth/register') return registered
        throw new ApiError(422, 'The invitation is invalid or has expired.')
      })
      const { wrapper } = await mountInvite()

      await fill(wrapper)

      expect(wrapper.find('[data-test=unusable]').exists()).toBe(true)
      expect(wrapper.find('[data-test=registered-unusable]').text()).toBe(
        'Your account was created, but the invitation could not be accepted.',
      )
    })
  })
})
