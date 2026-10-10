import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { i18n, setLocale } from '../i18n'
import { createAppRouter } from '../router'
import { TOKEN_STORAGE_KEY, useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import IntegrationsView from './IntegrationsView.vue'

const user = { id: 1, name: 'Test', email: 't@e.com', locale: 'en' }

function source(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    project_id: 7,
    name: `Source ${id}`,
    key_prefix: `wsk_ab${id}`,
    last_used_at: null,
    revoked_at: null,
    created_at: '2026-10-08T12:00:00Z',
    ...overrides,
  }
}

let wrapper: VueWrapper | undefined

async function mountView(roles: string[], path = '/projects/7/integrations') {
  localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().$patch({ user })
  useOrganizationStore().$patch({
    organizations: [{ id: 1, name: 'Acme', slug: 'acme', settings: null, roles }],
    activeId: 1,
    loaded: true,
  })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  wrapper = mount(IntegrationsView, { attachTo: document.body, global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return router
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  setLocale('en')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

describe('IntegrationsView', () => {
  it('lists name, key prefix, last use, creation and revocation', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: [source(1, { last_used_at: '2026-10-09T10:00:00Z' }), source(2, { revoked_at: '2026-10-09T11:00:00Z' })],
    })
    await mountView(['admin'])
    expect(get).toHaveBeenCalledWith('/api/projects/7/log-sources', { signal: expect.any(AbortSignal) })
    const rows = wrapper!.findAll('[data-test=source]')
    expect(rows).toHaveLength(2)
    expect(rows[0].find('[data-test=name]').text()).toBe('Source 1')
    expect(rows[0].find('[data-test=prefix]').text()).toBe('wsk_ab1…')
    expect(rows[0].find('[data-test=last-used]').text()).not.toBe('Never')
    expect(rows[0].find('[data-test=created]').text()).not.toBe('')
    expect(rows[0].find('[data-test=revoked]').exists()).toBe(false)
    expect(rows[1].find('[data-test=last-used]').text()).toBe('Never')
    expect(rows[1].find('[data-test=revoked]').exists()).toBe(true)
  })

  it('shows the empty state', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] })
    await mountView(['owner'])
    expect(wrapper!.find('[data-test=empty]').exists()).toBe(true)
    expect(wrapper!.findAll('[data-test=source]')).toHaveLength(0)
  })

  it('shows a loading state while the request is pending', async () => {
    vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined))
    await mountView(['owner'])
    expect(wrapper!.find('[data-test=loading]').exists()).toBe(true)
  })

  it('shows an error with retry when the list fails', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, 'boom', {}))
    await mountView(['owner'])
    expect(wrapper!.find('[data-test=load-failed]').exists()).toBe(true)
    get.mockResolvedValue({ data: [source(1)] })
    await wrapper!.find('button[name=retry]').trigger('click')
    await flushPromises()
    expect(wrapper!.findAll('[data-test=source]')).toHaveLength(1)
    expect(wrapper!.find('[data-test=load-failed]').exists()).toBe(false)
  })

  it('shows a notice instead of the list without permission and does not call the API', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: [source(1)] })
    await mountView(['member'])
    expect(wrapper!.find('[data-test=no-permission]').exists()).toBe(true)
    expect(wrapper!.find('[data-test=source]').exists()).toBe(false)
    expect(get).not.toHaveBeenCalled()
  })

  it('does not call the API for an invalid project id', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: [] })
    await mountView(['owner'], '/projects/abc/integrations')
    expect(wrapper!.find('[data-test=not-found]').exists()).toBe(true)
    expect(get).not.toHaveBeenCalled()
  })

  it('reloads when the project changes and discards the stale response', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined
    const get = vi
      .spyOn(api, 'get')
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ data: [source(2, { name: 'New' })] })
    const router = await mountView(['owner'])
    await router.push('/projects/8/integrations')
    await flushPromises()
    resolveFirst({ data: [source(1, { name: 'Old' })] })
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/api/projects/8/log-sources', { signal: expect.any(AbortSignal) })
    expect(wrapper!.findAll('[data-test=name]').map((el) => el.text())).toEqual(['New'])
  })
})
