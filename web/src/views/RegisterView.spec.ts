import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import * as registration from '../api/registration'
import { api, ApiError } from '../api/client'
import { resetRegistrationStatus } from '../composables/useRegistrationStatus'
import { i18n, setLocale } from '../i18n'
import { createAppRouter } from '../router'
import { useAuthStore } from '../stores/auth'

const user = { id: 1, name: 'Test', email: 't@e.com', locale: 'en' }

async function mountRegister(path = '/register', attachTo?: HTMLElement, open: boolean | Error = true) {
  const status = vi.spyOn(registration, 'registrationStatus')
  if (open instanceof Error) status.mockRejectedValue(open)
  else status.mockResolvedValue(open)
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [pinia, i18n, router] }, attachTo })
  await flushPromises()
  return { wrapper, router }
}

async function submit(wrapper: Awaited<ReturnType<typeof mountRegister>>['wrapper']) {
  await wrapper.find('input[name=name]').setValue('Ana')
  await wrapper.find('input[name=email]').setValue('t@e.com')
  await wrapper.find('input[name=password]').setValue('secret-pass')
  await wrapper.find('input[name=password_confirmation]').setValue('secret-pass')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('RegisterView', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    resetRegistrationStatus()
    setLocale('en')
  })

  it('shows only the closed message and a login link when registration is closed', async () => {
    const { wrapper } = await mountRegister('/register?redirect=/channels/3', undefined, false)
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('[data-test=closed]').text()).toContain(i18n.global.t('register.closed'))
    expect(wrapper.find('[data-test=login-link]').attributes('href')).toBe('/login?redirect=/channels/3')
  })

  it('shows an error with a retry button, not the closed message, when the status check fails', async () => {
    const { wrapper } = await mountRegister('/register', undefined, new Error('network'))
    expect(wrapper.find('[data-test=closed]').exists()).toBe(false)
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('[data-test=status-error]').text()).toContain(i18n.global.t('register.statusError'))
    vi.spyOn(registration, 'registrationStatus').mockResolvedValue(true)
    await wrapper.find('[data-test=retry]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test=status-error]').exists()).toBe(false)
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('shows a loading state while retrying, then focuses the name field', async () => {
    const { wrapper } = await mountRegister('/register', document.body, new Error('network'))
    let resolve: (value: boolean) => void = () => {}
    vi.spyOn(registration, 'registrationStatus').mockReturnValue(new Promise<boolean>((r) => (resolve = r)))
    await wrapper.find('[data-test=retry]').trigger('click')
    expect(wrapper.find('[data-test=loading]').text()).toBe(i18n.global.t('common.loading'))
    expect(wrapper.find('[data-test=status-error]').exists()).toBe(false)
    resolve(true)
    await flushPromises()
    expect(wrapper.find('[data-test=loading]').exists()).toBe(false)
    expect(document.activeElement).toBe(document.getElementById('register-name'))
    wrapper.unmount()
  })

  it('shows the error again when the retry fails too', async () => {
    const { wrapper } = await mountRegister('/register', undefined, new Error('network'))
    vi.spyOn(registration, 'registrationStatus').mockRejectedValue(new Error('network'))
    await wrapper.find('[data-test=retry]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test=loading]').exists()).toBe(false)
    expect(wrapper.find('[data-test=status-error]').text()).toContain(i18n.global.t('register.statusError'))
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('focuses the name field when open', async () => {
    const { wrapper } = await mountRegister('/register', document.body)
    expect(document.activeElement).toBe(document.getElementById('register-name'))
    wrapper.unmount()
  })

  it('registers and goes to projects', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ token: 'abc', user })
    const { wrapper, router } = await mountRegister()
    await submit(wrapper)
    expect(post).toHaveBeenCalledWith('/api/auth/register', {
      name: 'Ana',
      email: 't@e.com',
      password: 'secret-pass',
      password_confirmation: 'secret-pass',
    })
    expect(router.currentRoute.value.name).toBe('projects')
  })

  it('honors a local redirect and ignores external ones', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ token: 'abc', user })
    const local = await mountRegister('/register?redirect=/channels/3')
    await submit(local.wrapper)
    expect(local.router.currentRoute.value.fullPath).toBe('/channels/3')

    localStorage.clear()
    const external = await mountRegister('/register?redirect=//evil.com')
    await submit(external.wrapper)
    expect(external.router.currentRoute.value.name).toBe('projects')
  })

  it('links 422 errors to their fields and clears the passwords', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(422, 'invalid', { email: ['Taken'], password: ['Too short'] }),
    )
    const { wrapper, router } = await mountRegister()
    const email = wrapper.find('input[name=email]')
    const name = wrapper.find('input[name=name]')
    expect(email.attributes('aria-invalid')).toBeUndefined()
    await submit(wrapper)
    expect(wrapper.find('[data-test=error-email]').text()).toBe('Taken')
    expect(email.attributes('aria-invalid')).toBe('true')
    expect(email.attributes('aria-describedby')).toBe(wrapper.find('[data-test=error-email]').attributes('id'))
    const password = wrapper.find('input[name=password]')
    expect(password.attributes('aria-invalid')).toBe('true')
    expect(password.attributes('aria-describedby')).toBe(wrapper.find('[data-test=error-password]').attributes('id'))
    expect(name.attributes('aria-invalid')).toBeUndefined()
    expect((password.element as HTMLInputElement).value).toBe('')
    expect((wrapper.find('input[name=password_confirmation]').element as HTMLInputElement).value).toBe('')
    expect((name.element as HTMLInputElement).value).toBe('Ana')
    expect(router.currentRoute.value.name).toBe('register')
  })

  it('shows a generic message on a 422 without field errors', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid', {}))
    const { wrapper } = await mountRegister()
    await submit(wrapper)
    expect(wrapper.find('[data-test=error-form]').text()).toBe(i18n.global.t('register.failed'))
  })

  it('shows the general error when a 422 only has errors for fields not on the form', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(422, 'invalid', { password_confirmation: ['Does not match'], invitation_token: ['Bad'] }),
    )
    const { wrapper } = await mountRegister()
    await submit(wrapper)
    expect(wrapper.find('[data-test=error-form]').text()).toBe(i18n.global.t('register.failed'))
  })

  it('does nothing after unmount when the pending register resolves', async () => {
    let resolve!: (value: unknown) => void
    vi.spyOn(api, 'post').mockReturnValue(new Promise((r) => (resolve = r)))
    const { wrapper, router } = await mountRegister()
    const push = vi.spyOn(router, 'push')
    await submit(wrapper)
    wrapper.unmount()
    resolve({ token: 'abc', user })
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
  })

  it('does nothing after unmount when the pending register is rejected', async () => {
    let reject!: (reason: unknown) => void
    vi.spyOn(api, 'post').mockReturnValue(new Promise((_, r) => (reject = r)))
    const { wrapper, router } = await mountRegister()
    const push = vi.spyOn(router, 'push')
    await submit(wrapper)
    wrapper.unmount()
    reject(new ApiError(422, 'invalid', { email: ['Taken'] }))
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
  })

  it('shows the closed message on a 403', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(403, 'Registration is closed.'))
    const { wrapper } = await mountRegister()
    await submit(wrapper)
    expect(wrapper.find('[data-test=error-form]').text()).toBe(i18n.global.t('register.closedError'))
    expect(useAuthStore().isAuthenticated).toBe(false)
  })

  it('shows a message on 429', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(429, 'Too Many Attempts.'))
    const { wrapper } = await mountRegister()
    await submit(wrapper)
    expect(wrapper.find('[data-test=error-form]').text()).toBe(i18n.global.t('register.tooManyAttempts'))
  })

  it('shows a message on a network error', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(0, 'network'))
    const { wrapper } = await mountRegister()
    await submit(wrapper)
    expect(wrapper.find('[data-test=error-form]').text()).toBe(i18n.global.t('register.network'))
  })

  it('redirects an authenticated user away from the page', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.token = 'abc'
    auth.user = user
    vi.spyOn(registration, 'registrationStatus').mockResolvedValue(true)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/register')
    expect(router.currentRoute.value.name).toBe('projects')
  })
})
