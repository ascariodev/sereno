import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import { toast, toasts } from '../components/ui/toast'
import { config } from '../config'
import { i18n, setLocale } from '../i18n'
import { useOrganizationStore } from '../stores/organization'
import AccessTokensView from './AccessTokensView.vue'

function token(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Token ${id}`,
    last_used_at: null,
    expires_at: null,
    created_at: '2026-10-08T12:00:00Z',
    ...overrides,
  }
}

function connection(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    client: { id: `uuid-${id}`, name: `Claude ${id}` },
    organization: { id: 1, name: 'Acme' },
    created_at: '2026-10-10T12:00:00Z',
    ...overrides,
  }
}

function mockGet(tokens: unknown[], connections: unknown[] = []) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/api/access-tokens') return { data: tokens }
    if (path === '/api/oauth-connections') return { data: connections }
    throw new Error(`unexpected GET ${path}`)
  })
}

let wrapper: VueWrapper | undefined
let organization: ReturnType<typeof useOrganizationStore>

async function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  organization = useOrganizationStore()
  organization.$patch({ organizations: [{ id: 1, name: 'Acme', slug: 'acme', settings: null, roles: ['member'] }], activeId: 1, loaded: true })
  wrapper = mount(AccessTokensView, { attachTo: document.body, global: { plugins: [pinia, i18n] } })
  await flushPromises()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function switchOrganization() {
  organization.$patch({
    organizations: [
      { id: 1, name: 'Acme', slug: 'acme', settings: null, roles: ['member'] },
      { id: 2, name: 'Beta', slug: 'beta', settings: null, roles: ['member'] },
    ],
    activeId: 2,
  })
}

const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)

async function openCreate() {
  await wrapper!.find('[data-test=create]').trigger('click')
  await flushPromises()
}

async function submitCreate(name: string) {
  const input = q<HTMLInputElement>('[role=dialog] input[name=name]')!
  input.value = name
  input.dispatchEvent(new Event('input'))
  q<HTMLFormElement>('[role=dialog] form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  toast.clear()
  setLocale('en')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

describe('AccessTokensView', () => {
  it('lists name, last use and expiry, flagging expired tokens', async () => {
    const get = mockGet([
      token(1, { last_used_at: '2026-10-10T12:00:00Z', expires_at: '2099-01-01T00:00:00Z' }),
      token(2, { expires_at: '2020-01-01T00:00:00Z' }),
    ])
    await mountView()
    expect(get).toHaveBeenCalledWith('/api/access-tokens', { signal: expect.any(AbortSignal) })
    const rows = wrapper!.findAll('[data-test=token]')
    expect(rows).toHaveLength(2)
    expect(rows[0].find('[data-test=name]').text()).toBe('Token 1')
    expect(rows[0].find('[data-test=last-used]').text()).not.toBe('Never')
    expect(rows[0].find('[data-test=expired]').exists()).toBe(false)
    expect(rows[1].find('[data-test=last-used]').text()).toBe('Never')
    expect(rows[1].find('[data-test=expired]').exists()).toBe(true)
  })

  it('shows the empty state', async () => {
    mockGet([])
    await mountView()
    expect(wrapper!.find('[data-test=empty]').exists()).toBe(true)
  })

  it('shows an error with retry when the list fails', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/access-tokens') throw new ApiError(500, 'boom', {})
      if (path === '/api/oauth-connections') return { data: [] }
      throw new Error(`unexpected GET ${path}`)
    })
    await mountView()
    expect(wrapper!.find('[data-test=load-failed]').exists()).toBe(true)
    get.mockImplementation(async (path: string) => {
      if (path === '/api/access-tokens') return { data: [token(1)] }
      if (path === '/api/oauth-connections') return { data: [] }
      throw new Error(`unexpected GET ${path}`)
    })
    await wrapper!.find('button[name=retry]').trigger('click')
    await flushPromises()
    expect(wrapper!.findAll('[data-test=token]')).toHaveLength(1)
  })

  it('creates a token, shows it once with the Claude Code command and drops it on close', async () => {
    mockGet([])
    const post = vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
      if (path === '/api/access-tokens') return { data: token(5, { name: 'Laptop' }), token: '5|SECRETSECRET' }
      throw new Error(`unexpected POST ${path}`)
    })
    await mountView()
    await openCreate()
    await submitCreate('  Laptop ')
    expect(post).toHaveBeenCalledWith('/api/access-tokens', { name: 'Laptop', expires_in_days: null })
    expect(q('[data-test=token-value]')!.textContent).toBe('5|SECRETSECRET')
    expect(q('[data-test=command]')!.textContent).toBe(
      `claude mcp add --transport http sereno ${config.apiUrl}/mcp --header "Authorization: Bearer 5|SECRETSECRET"`,
    )
    expect(wrapper!.findAll('[data-test=name]').map((el) => el.text())).toEqual(['Laptop'])
    q<HTMLButtonElement>('[data-test=done]')!.click()
    await flushPromises()
    expect(document.body.textContent).not.toContain('SECRETSECRET')
    expect(q('[role=dialog]')).toBeNull()
  })

  it('sends the chosen expiration', async () => {
    mockGet([])
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: token(6), token: '6|X' })
    await mountView()
    await openCreate()
    const select = q<HTMLSelectElement>('[role=dialog] select')!
    select.value = '90'
    select.dispatchEvent(new Event('change'))
    await submitCreate('Ci')
    expect(post).toHaveBeenCalledWith('/api/access-tokens', { name: 'Ci', expires_in_days: 90 })
  })

  it('shows the validation error and keeps the form open', async () => {
    mockGet([])
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid', { name: ['The name field is required.'] }))
    await mountView()
    await openCreate()
    await submitCreate('')
    expect(q('[data-test=error-name]')!.textContent).toContain('required')
    expect(q('[role=dialog] form')).not.toBeNull()
    expect(q('[data-test=token-value]')).toBeNull()
  })

  it('asks for confirmation, revokes and removes the row', async () => {
    mockGet([token(1), token(2)])
    const revoke = vi.spyOn(api, 'delete').mockResolvedValue(undefined)
    await mountView()
    await wrapper!.findAll('[data-test=revoke]')[0].trigger('click')
    await flushPromises()
    expect(q('[data-test=confirm-text]')!.textContent).toContain('Token 1')
    expect(revoke).not.toHaveBeenCalled()
    q<HTMLButtonElement>('[data-test=confirm]')!.click()
    await flushPromises()
    expect(revoke).toHaveBeenCalledWith('/api/access-tokens/1')
    expect(wrapper!.findAll('[data-test=name]').map((el) => el.text())).toEqual(['Token 2'])
    expect(toasts.value.map((item) => item.kind)).toEqual(['success'])
  })

  it('moves focus to the neighbouring revoke button after revoking, or the title when none is left', async () => {
    mockGet([token(1), token(2)])
    vi.spyOn(api, 'delete').mockResolvedValue(undefined)
    await mountView()
    await wrapper!.findAll('[data-test=revoke]')[0].trigger('click')
    await flushPromises()
    q<HTMLButtonElement>('[data-test=confirm]')!.click()
    await flushPromises()
    expect(document.activeElement).toBe(q('[data-token-id="2"] [data-test=revoke]'))
    await wrapper!.find('[data-test=revoke]').trigger('click')
    await flushPromises()
    q<HTMLButtonElement>('[data-test=confirm]')!.click()
    await flushPromises()
    expect(document.activeElement).toBe(q('h1'))
  })

  it('cancelling keeps the token and does not call the API', async () => {
    mockGet([token(1)])
    const revoke = vi.spyOn(api, 'delete')
    await mountView()
    await wrapper!.find('[data-test=revoke]').trigger('click')
    await flushPromises()
    q<HTMLButtonElement>('[data-test=revoke-cancel]')!.click()
    await flushPromises()
    expect(revoke).not.toHaveBeenCalled()
    expect(wrapper!.findAll('[data-test=token]')).toHaveLength(1)
  })

  it('drops a token that is already gone on 404', async () => {
    mockGet([token(1)])
    vi.spyOn(api, 'delete').mockRejectedValue(new ApiError(404, 'gone', {}))
    await mountView()
    await wrapper!.find('[data-test=revoke]').trigger('click')
    await flushPromises()
    q<HTMLButtonElement>('[data-test=confirm]')!.click()
    await flushPromises()
    expect(wrapper!.findAll('[data-test=token]')).toHaveLength(0)
    expect(toasts.value.map((item) => item.kind)).toEqual(['info'])
  })

  it('reloads when the active organization changes', async () => {
    const get = mockGet([token(1)])
    await mountView()
    organization.$patch({
      organizations: [
        { id: 1, name: 'Acme', slug: 'acme', settings: null, roles: ['member'] },
        { id: 2, name: 'Beta', slug: 'beta', settings: null, roles: ['member'] },
      ],
      activeId: 2,
    })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(4)
  })
  it('discards a late list response after the organization changes', async () => {
    const stale = deferred<{ data: unknown[] }>()
    let calls = 0
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/oauth-connections') return { data: [] }
      return ++calls === 1 ? stale.promise : { data: [token(2)] }
    })
    const pinia = createPinia()
    setActivePinia(pinia)
    organization = useOrganizationStore()
    organization.$patch({ organizations: [{ id: 1, name: 'Acme', slug: 'acme', settings: null, roles: ['member'] }], activeId: 1, loaded: true })
    wrapper = mount(AccessTokensView, { attachTo: document.body, global: { plugins: [pinia, i18n] } })
    switchOrganization()
    await flushPromises()
    stale.resolve({ data: [token(1)] })
    await flushPromises()
    expect(wrapper.findAll('[data-test=name]').map((el) => el.text())).toEqual(['Token 2'])
    expect(wrapper.find('[data-test=loading]').exists()).toBe(false)
  })

  it('aborts the list request on unmount', async () => {
    const signals: AbortSignal[] = []
    vi.spyOn(api, 'get').mockImplementation(async (_path: string, options?: { signal?: AbortSignal }) => {
      if (options?.signal) signals.push(options.signal)
      return new Promise(() => {})
    })
    await mountView()
    wrapper!.unmount()
    wrapper = undefined
    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  it('ignores an AbortError from the token and connection loads', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (_path: string, options?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    })
    await mountView()
    switchOrganization()
    await flushPromises()
    wrapper!.unmount()
    wrapper = undefined
    await flushPromises()
  })

  it('discards a late create response after the organization changes', async () => {
    mockGet([])
    const late = deferred<{ data: unknown; token: string }>()
    vi.spyOn(api, 'post').mockImplementation(async () => late.promise)
    await mountView()
    await openCreate()
    await submitCreate('Laptop')
    switchOrganization()
    await flushPromises()
    late.resolve({ data: token(5, { name: 'Laptop' }), token: '5|SECRETSECRET' })
    await flushPromises()
    expect(document.body.textContent).not.toContain('SECRETSECRET')
    expect(q('[data-test=token-value]')).toBeNull()
    expect(wrapper!.findAll('[data-test=token]')).toHaveLength(0)
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).toContain('Laptop')
    expect(toasts.value[0].message).not.toContain('SECRETSECRET')
  })

  it('discards a late revoke response after the organization changes', async () => {
    mockGet([token(1)])
    const late = deferred<undefined>()
    vi.spyOn(api, 'delete').mockImplementation(async () => late.promise)
    await mountView()
    await wrapper!.find('[data-test=revoke]').trigger('click')
    await flushPromises()
    q<HTMLButtonElement>('[data-test=confirm]')!.click()
    await flushPromises()
    switchOrganization()
    await flushPromises()
    late.resolve(undefined)
    await flushPromises()
    expect(wrapper!.findAll('[data-test=token]')).toHaveLength(1)
    expect(toasts.value).toHaveLength(0)
  })

  it('discards a late revoke response after unmount', async () => {
    mockGet([token(1)])
    const late = deferred<undefined>()
    vi.spyOn(api, 'delete').mockImplementation(async () => late.promise)
    await mountView()
    await wrapper!.find('[data-test=revoke]').trigger('click')
    await flushPromises()
    q<HTMLButtonElement>('[data-test=confirm]')!.click()
    await flushPromises()
    wrapper!.unmount()
    wrapper = undefined
    late.resolve(undefined)
    await flushPromises()
    expect(toasts.value).toHaveLength(0)
  })

  describe('connections', () => {
    it('lists the OAuth connections with the client name and date', async () => {
      const get = mockGet([], [connection(1), connection(2)])
      await mountView()
      expect(get).toHaveBeenCalledWith('/api/oauth-connections', { signal: expect.any(AbortSignal) })
      const rows = wrapper!.findAll('[data-test=connection]')
      expect(rows.map((row) => row.find('[data-test=connection-name]').text())).toEqual(['Claude 1', 'Claude 2'])
      expect(rows[0].find('[data-test=connection-date]').text()).not.toBe('')
      expect(wrapper!.find('[data-test=connections-empty]').exists()).toBe(false)
    })

    it('shows the empty state', async () => {
      mockGet([token(1)], [])
      await mountView()
      expect(wrapper!.find('[data-test=connections-empty]').exists()).toBe(true)
      expect(wrapper!.findAll('[data-test=token]')).toHaveLength(1)
    })

    it('keeps the tokens when only the connections fail, and retries', async () => {
      let fail = true
      vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
        if (path === '/api/access-tokens') return { data: [token(1)] }
        if (path === '/api/oauth-connections') {
          if (fail) throw new ApiError(500, 'boom', {})
          return { data: [connection(1)] }
        }
        throw new Error(`unexpected GET ${path}`)
      })
      await mountView()
      expect(wrapper!.find('[data-test=connections-load-failed]').exists()).toBe(true)
      expect(wrapper!.findAll('[data-test=token]')).toHaveLength(1)
      fail = false
      await wrapper!.find('button[name=retry-connections]').trigger('click')
      await flushPromises()
      expect(wrapper!.findAll('[data-test=connection]')).toHaveLength(1)
    })

    it('asks for confirmation, disconnects and removes the row', async () => {
      mockGet([], [connection(1), connection(2)])
      const revoke = vi.spyOn(api, 'delete').mockResolvedValue(undefined)
      await mountView()
      await wrapper!.findAll('[data-test=disconnect]')[0].trigger('click')
      await flushPromises()
      expect(q('[data-test=disconnect-text]')!.textContent).toContain('Claude 1')
      expect(revoke).not.toHaveBeenCalled()
      q<HTMLButtonElement>('[data-test=disconnect-confirm]')!.click()
      await flushPromises()
      expect(revoke).toHaveBeenCalledWith('/api/oauth-connections/1')
      expect(wrapper!.findAll('[data-test=connection-name]').map((el) => el.text())).toEqual(['Claude 2'])
      expect(toasts.value.map((item) => item.kind)).toEqual(['success'])
    })

    it('moves focus to the neighbouring disconnect button, or the heading when none is left', async () => {
      mockGet([], [connection(1), connection(2)])
      vi.spyOn(api, 'delete').mockResolvedValue(undefined)
      await mountView()
      await wrapper!.findAll('[data-test=disconnect]')[0].trigger('click')
      await flushPromises()
      q<HTMLButtonElement>('[data-test=disconnect-confirm]')!.click()
      await flushPromises()
      expect(document.activeElement).toBe(q('[data-connection-id="2"] [data-test=disconnect]'))
      await wrapper!.find('[data-test=disconnect]').trigger('click')
      await flushPromises()
      q<HTMLButtonElement>('[data-test=disconnect-confirm]')!.click()
      await flushPromises()
      expect(document.activeElement).toBe(q('h2'))
    })

    it('cancelling does not call the API', async () => {
      mockGet([], [connection(1)])
      const revoke = vi.spyOn(api, 'delete')
      await mountView()
      await wrapper!.find('[data-test=disconnect]').trigger('click')
      await flushPromises()
      q<HTMLButtonElement>('[data-test=disconnect-cancel]')!.click()
      await flushPromises()
      expect(revoke).not.toHaveBeenCalled()
      expect(wrapper!.findAll('[data-test=connection]')).toHaveLength(1)
    })

    it('drops a connection that is already gone on 404', async () => {
      mockGet([], [connection(1)])
      vi.spyOn(api, 'delete').mockRejectedValue(new ApiError(404, 'gone', {}))
      await mountView()
      await wrapper!.find('[data-test=disconnect]').trigger('click')
      await flushPromises()
      q<HTMLButtonElement>('[data-test=disconnect-confirm]')!.click()
      await flushPromises()
      expect(wrapper!.findAll('[data-test=connection]')).toHaveLength(0)
      expect(toasts.value.map((item) => item.kind)).toEqual(['info'])
    })

    it('keeps the connection and reports an error when disconnecting fails', async () => {
      mockGet([], [connection(1)])
      vi.spyOn(api, 'delete').mockRejectedValue(new ApiError(500, 'boom', {}))
      await mountView()
      await wrapper!.find('[data-test=disconnect]').trigger('click')
      await flushPromises()
      q<HTMLButtonElement>('[data-test=disconnect-confirm]')!.click()
      await flushPromises()
      expect(wrapper!.findAll('[data-test=connection]')).toHaveLength(1)
      expect(toasts.value.map((item) => item.kind)).toEqual(['error'])
    })

    it('discards a late connections response after the organization changes', async () => {
      const stale = deferred<{ data: unknown[] }>()
      let calls = 0
      vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
        if (path === '/api/access-tokens') return { data: [] }
        return ++calls === 1 ? stale.promise : { data: [connection(2)] }
      })
      const pinia = createPinia()
      setActivePinia(pinia)
      organization = useOrganizationStore()
      organization.$patch({ organizations: [{ id: 1, name: 'Acme', slug: 'acme', settings: null, roles: ['member'] }], activeId: 1, loaded: true })
      wrapper = mount(AccessTokensView, { attachTo: document.body, global: { plugins: [pinia, i18n] } })
      switchOrganization()
      await flushPromises()
      stale.resolve({ data: [connection(1)] })
      await flushPromises()
      expect(wrapper.findAll('[data-test=connection-name]').map((el) => el.text())).toEqual(['Claude 2'])
      expect(wrapper.find('[data-test=connections-loading]').exists()).toBe(false)
    })

    it('discards a late disconnect response after the organization changes', async () => {
      mockGet([], [connection(1)])
      const late = deferred<undefined>()
      vi.spyOn(api, 'delete').mockImplementation(async () => late.promise)
      await mountView()
      await wrapper!.find('[data-test=disconnect]').trigger('click')
      await flushPromises()
      q<HTMLButtonElement>('[data-test=disconnect-confirm]')!.click()
      await flushPromises()
      switchOrganization()
      await flushPromises()
      late.resolve(undefined)
      await flushPromises()
      expect(toasts.value).toHaveLength(0)
    })
  })
})
