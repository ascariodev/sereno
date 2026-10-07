import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { i18n } from '../i18n'
import { createAppRouter } from '../router'
import { TOKEN_STORAGE_KEY } from '../stores/auth'

const user = { id: 1, name: 'Test', email: 't@e.com', locale: 'en' }

async function mountError(path = '/session-error') {
  localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('SessionErrorView', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('retry success redirects to the original route', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: user })
    const { wrapper, router } = await mountError('/session-error?redirect=/channels/3')
    await wrapper.find('[data-test=retry]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/channels/3')
  })

  it('retry success ignores external redirects', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: user })
    const { wrapper, router } = await mountError('/session-error?redirect=//evil.com')
    await wrapper.find('[data-test=retry]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('projects')
  })

  it('retry failure shows the error again and stays', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(503, 'Unavailable'))
    const { wrapper, router } = await mountError()
    await wrapper.find('[data-test=retry]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test=error-retry]').text()).toBe(i18n.global.t('sessionError.failed'))
    expect(router.currentRoute.value.name).toBe('session-error')
  })
})
