import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { i18n, setLocale } from '../i18n'
import { createAppRouter } from '../router'
import { safeRedirect } from '../router/safeRedirect'
import { TOKEN_STORAGE_KEY } from '../stores/auth'
import { ORGANIZATION_STORAGE_KEY } from '../stores/organization'

const user = { id: 1, name: 'Test', email: 't@e.com', locale: 'en' }
const authorization = {
  client: { id: 'client-1', name: 'Claude' },
  redirect_host: 'claude.ai',
  scopes: ['mcp:use'],
  organizations: [
    { id: 1, name: 'Own' },
    { id: 7, name: 'Acme' },
  ],
}
const QUERY =
  'response_type=code&client_id=client-1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&code_challenge=abc&code_challenge_method=S256&state=xyz+1'
const PATH = `/oauth/authorize?${QUERY}`
const EXPECTED_QUERY = {
  response_type: 'code',
  client_id: 'client-1',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  code_challenge: 'abc',
  code_challenge_method: 'S256',
  state: 'xyz 1',
}

function mockGet(authorize: () => unknown = () => authorization) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/api/me') return { data: user }
    if (path === '/api/oauth/authorize') return authorize()
    throw new Error(`unexpected GET ${path}`)
  })
}

async function mountConsent(path = PATH) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return { wrapper, router }
}

async function mountAttached(path = PATH) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [pinia, i18n, router] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('OAuthAuthorizeView', () => {
  const assign = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    vi.restoreAllMocks()
    assign.mockReset()
    vi.stubGlobal('location', { ...window.location, assign })
    setLocale('en')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the request with the OAuth query intact and shows the client and the redirect host', async () => {
    const get = mockGet()
    const { wrapper } = await mountConsent()

    const call = get.mock.calls.find(([path]) => path === '/api/oauth/authorize')
    expect(call?.[1]).toMatchObject({ query: EXPECTED_QUERY })
    expect(wrapper.find('h1').text()).toBe('Connect Claude to Sereno')
    expect(wrapper.find('[data-test=description]').text()).toContain('Claude')
    expect(wrapper.find('[data-test=return-to]').text()).toBe('You will be sent back to: claude.ai')
    expect(wrapper.find('strong[data-test=redirect-host]').text()).toBe('claude.ai')
    expect(wrapper.findAll('option').map((option) => option.text())).toEqual(['Own', 'Acme'])
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('1')
  })

  it('preselects the stored active organization', async () => {
    localStorage.setItem(ORGANIZATION_STORAGE_KEY, '7')
    mockGet()
    const { wrapper } = await mountConsent()
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('7')
  })

  it('approves with the chosen organization and goes to the returned url', async () => {
    mockGet()
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=c&state=xyz' })
    const { wrapper } = await mountConsent()

    await wrapper.find('select').setValue('7')
    await wrapper.find('[data-test=approve]').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith(
      '/api/oauth/authorize',
      { organization_id: 7 },
      expect.objectContaining({ query: EXPECTED_QUERY }),
    )
    expect(assign).toHaveBeenCalledExactlyOnceWith('https://claude.ai/api/mcp/auth_callback?code=c&state=xyz')
    expect(wrapper.find('[data-test=approve]').attributes('disabled')).toBeDefined()
  })

  it('does not follow a redirect_url that is not http(s)', async () => {
    mockGet()
    vi.spyOn(api, 'post').mockResolvedValue({ redirect_url: 'javascript:alert(1)' })
    const { wrapper } = await mountConsent()

    await wrapper.find('[data-test=approve]').trigger('click')
    await flushPromises()

    expect(assign).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test=action-error]').exists()).toBe(true)
  })

  it('denies without a body and goes to the returned url', async () => {
    mockGet()
    const del = vi
      .spyOn(api, 'delete')
      .mockResolvedValue({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?error=access_denied' })
    const { wrapper } = await mountConsent()

    await wrapper.find('[data-test=deny]').trigger('click')
    await flushPromises()

    expect(del).toHaveBeenCalledWith('/api/oauth/authorize', expect.objectContaining({ query: EXPECTED_QUERY }))
    expect(assign).toHaveBeenCalledExactlyOnceWith('https://claude.ai/api/mcp/auth_callback?error=access_denied')
  })

  it('shows the API message for an invalid request and no actions', async () => {
    mockGet(() => {
      throw new ApiError(400, 'The authorization request is invalid.')
    })
    const { wrapper } = await mountConsent()

    expect(wrapper.find('[data-test=invalid]').text()).toBe('The authorization request is invalid.')
    expect(wrapper.find('[data-test=approve]').exists()).toBe(false)
    expect(wrapper.find('[data-test=deny]').exists()).toBe(false)
  })

  it('shows the invalid state when approving is rejected with 400', async () => {
    mockGet()
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(400, 'The authorization request is invalid.'))
    const { wrapper } = await mountConsent()

    await wrapper.find('[data-test=approve]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test=invalid]').exists()).toBe(true)
    expect(assign).not.toHaveBeenCalled()
  })

  it('offers a retry when the load fails for another reason', async () => {
    let fail = true
    mockGet(() => {
      if (fail) throw new ApiError(500, 'boom')
      return authorization
    })
    const { wrapper } = await mountConsent()

    expect(wrapper.find('[data-test=approve]').exists()).toBe(false)
    fail = false
    await wrapper.find('[data-test=retry]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test=approve]').exists()).toBe(true)
  })

  it('disables approving when the user has no organizations', async () => {
    mockGet(() => ({ ...authorization, organizations: [] }))
    const { wrapper } = await mountConsent()

    expect(wrapper.find('[data-test=no-organizations]').exists()).toBe(true)
    expect(wrapper.find('[data-test=approve]').attributes('disabled')).toBeDefined()
  })

  it('shows a network error and allows trying again', async () => {
    mockGet()
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(0, 'Network error'))
    const { wrapper } = await mountConsent()

    await wrapper.find('[data-test=approve]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test=action-error]').text()).toBe('Could not reach the server.')
    expect(wrapper.find('[data-test=approve]').attributes('disabled')).toBeUndefined()
  })

  it('ignores a response that arrives after unmounting', async () => {
    mockGet()
    let resolve: (value: unknown) => void = () => {}
    vi.spyOn(api, 'post').mockReturnValue(new Promise((r) => (resolve = r)))
    const { wrapper } = await mountConsent()

    await wrapper.find('[data-test=approve]').trigger('click')
    wrapper.unmount()
    resolve({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=c' })
    await flushPromises()

    expect(assign).not.toHaveBeenCalled()
  })

  it('moves focus to the heading once loaded', async () => {
    mockGet()
    const wrapper = await mountAttached()

    expect(document.activeElement).toBe(wrapper.find('h1').element)
    expect(wrapper.find('h1').attributes('tabindex')).toBe('-1')
    wrapper.unmount()
  })

  it('moves focus to the heading of the invalid state', async () => {
    mockGet(() => {
      throw new ApiError(400, 'The authorization request is invalid.')
    })
    const wrapper = await mountAttached()

    expect(document.activeElement).toBe(wrapper.find('h1').element)
    wrapper.unmount()
  })

  it('keeps a polite live region that announces the redirect', async () => {
    mockGet()
    vi.spyOn(api, 'post').mockResolvedValue({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=c' })
    const { wrapper } = await mountConsent()

    const region = wrapper.find('[data-test=redirecting]')
    expect(region.attributes('aria-live')).toBe('polite')
    expect(region.attributes('role')).toBe('status')
    expect(region.text()).toBe('')

    await wrapper.find('[data-test=approve]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test=redirecting]').element).toBe(region.element)
    expect(region.text()).toContain('claude.ai')
  })

  it('without a session goes to login keeping the whole OAuth query, and returns to it', async () => {
    localStorage.clear()
    const router = createAppRouter(createMemoryHistory())
    setActivePinia(createPinia())
    await router.push(PATH)

    expect(router.currentRoute.value.name).toBe('login')
    const redirect = router.currentRoute.value.query.redirect
    expect(redirect).toBe(PATH)
    expect(safeRedirect(redirect)).toBe(PATH)
  })
})
