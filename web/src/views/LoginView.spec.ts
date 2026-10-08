import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { i18n, LOCALE_STORAGE_KEY, setLocale } from '../i18n'
import { createAppRouter } from '../router'

const user = { id: 1, name: 'Test', email: 't@e.com', locale: 'en' }

async function mountLogin(path = '/login') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return { wrapper, router }
}

async function submit(wrapper: Awaited<ReturnType<typeof mountLogin>>['wrapper']) {
  await wrapper.find('input[name=email]').setValue('t@e.com')
  await wrapper.find('input[name=password]').setValue('secret')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('LoginView', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    setLocale('en')
  })

  it('saves the language chosen before signing in and updates the page', async () => {
    const { wrapper } = await mountLogin()
    const buttons = wrapper.findAll('[aria-label="Language"] button')
    expect(buttons.map((b) => b.text())).toEqual(['ES', 'EN'])
    await buttons[0]!.trigger('click')
    await flushPromises()
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es')
    expect(document.documentElement.lang).toBe('es')
    expect(wrapper.find('h1').text()).toBe('Iniciar sesión')
    expect(wrapper.find('[aria-label="Idioma"] button[data-state=on]').text()).toBe('ES')
  })

  it('lets the user locale win over the saved choice after signing in', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    setLocale(null)
    vi.spyOn(api, 'post').mockResolvedValue({ token: 'abc', user })
    const { wrapper } = await mountLogin()
    await submit(wrapper)
    expect(i18n.global.locale.value).toBe('en')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es')
  })

  it('submits and redirects to projects', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ token: 'abc', user })
    const { wrapper, router } = await mountLogin()
    await submit(wrapper)
    expect(post).toHaveBeenCalledWith('/api/auth/login', { email: 't@e.com', password: 'secret' })
    expect(router.currentRoute.value.name).toBe('projects')
  })

  it('honors a local redirect and ignores external ones', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ token: 'abc', user })
    const local = await mountLogin('/login?redirect=/channels/3')
    await submit(local.wrapper)
    expect(local.router.currentRoute.value.fullPath).toBe('/channels/3')

    localStorage.clear()
    const external = await mountLogin('/login?redirect=//evil.com')
    await submit(external.wrapper)
    expect(external.router.currentRoute.value.name).toBe('projects')
  })

  it('shows the email error from a 422', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid', { email: ['Bad credentials'] }))
    const { wrapper, router } = await mountLogin()
    await submit(wrapper)
    expect(wrapper.find('[data-test=error-email]').text()).toBe('Bad credentials')
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('marks only inputs with errors as invalid and links them to the error', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid', { email: ['Bad credentials'] }))
    const { wrapper } = await mountLogin()
    const email = wrapper.find('input[name=email]')
    const password = wrapper.find('input[name=password]')
    expect(email.attributes('aria-invalid')).toBeUndefined()
    expect(email.attributes('aria-describedby')).toBeUndefined()
    await submit(wrapper)
    const errorId = wrapper.find('[data-test=error-email]').attributes('id')
    expect(email.attributes('aria-invalid')).toBe('true')
    expect(email.attributes('aria-describedby')).toBe(errorId)
    expect(password.attributes('aria-invalid')).toBeUndefined()
    expect(password.attributes('aria-describedby')).toBeUndefined()
  })

  it('shows a generic message on a 422 without email or password errors', async () => {
    const post = vi.spyOn(api, 'post')
    post.mockRejectedValueOnce(new ApiError(422, 'invalid', { other: ['x'] }))
    const { wrapper } = await mountLogin()
    await submit(wrapper)
    expect(wrapper.find('[data-test=error-form]').text()).toBe(i18n.global.t('login.failed'))

    post.mockRejectedValueOnce(new ApiError(422, 'invalid', {}))
    await submit(wrapper)
    expect(wrapper.find('[data-test=error-form]').text()).toBe(i18n.global.t('login.failed'))
  })

  it('shows a message on 429', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(429, 'Too Many Attempts.'))
    const { wrapper } = await mountLogin()
    await submit(wrapper)
    expect(wrapper.find('[data-test=error-form]').text()).toBe(i18n.global.t('login.tooManyAttempts'))
  })
})
