import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { toast, toasts } from '../components/ui/toast'
import { i18n, setLocale } from '../i18n'
import { createAppRouter } from '../router'
import { TOKEN_STORAGE_KEY, useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import InvitationsView from './InvitationsView.vue'

const user = { id: 1, name: 'Test', email: 't@e.com', locale: 'en' }

function invitation(id: number, role: 'owner' | 'admin' | 'member', overrides: Record<string, unknown> = {}) {
  return {
    id,
    email: `p${id}@e.com`,
    role,
    locale: 'en',
    invited_by: { id: 1, name: 'Ada' },
    expires_at: '2026-10-15T12:00:00Z',
    created_at: '2026-10-08T12:00:00Z',
    ...overrides,
  }
}

type Roles = string[]

function organizationList(roles: Roles) {
  return [{ id: 1, name: 'Acme', slug: 'acme', settings: null, roles }]
}

function mockGet(roles: Roles, invitations: unknown[] = [], organizations = organizationList(roles)) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/api/me') return { data: user }
    if (path === '/api/organizations') return { data: organizations }
    if (path === '/api/invitations') return { data: invitations }
    return { data: [] }
  })
}

let wrapper: VueWrapper | undefined

async function mountDirect(roles: Roles | null) {
  localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().$patch({ user })
  const organization = useOrganizationStore()
  if (roles) organization.$patch({ organizations: organizationList(roles), activeId: 1, loaded: true })
  const router = createAppRouter(createMemoryHistory())
  await router.push('/settings/invitations').catch(() => undefined)
  wrapper = mount(InvitationsView, { attachTo: document.body, global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return { router, organization }
}

async function mountApp() {
  localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push('/settings/invitations')
  await router.isReady()
  wrapper = mount({ template: '<RouterView />' }, { attachTo: document.body, global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return { router }
}

function dialogButton(name: string): HTMLButtonElement | null {
  return document.querySelector(`[role=dialog] [data-test=${name}]`)
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

describe('InvitationsView', () => {
  it('lists email, role, inviter and expiry', async () => {
    const get = mockGet(['owner'], [invitation(1, 'admin'), invitation(2, 'member', { invited_by: null })])
    await mountDirect(['owner'])
    expect(get).toHaveBeenCalledWith('/api/invitations', { signal: expect.any(AbortSignal) })
    const rows = wrapper!.findAll('[data-test=invitation]')
    expect(rows).toHaveLength(2)
    expect(rows[0].find('[data-test=email]').text()).toBe('p1@e.com')
    expect(rows[0].find('[data-test=role]').text()).toBe('Admin')
    expect(rows[0].find('[data-test=inviter]').text()).toBe('Ada')
    expect(rows[0].find('[data-test=expires]').text()).not.toBe('')
    expect(rows[1].find('[data-test=inviter]').text()).toBe('Unknown')
  })

  it('shows the empty state', async () => {
    mockGet(['admin'], [])
    await mountDirect(['admin'])
    expect(wrapper!.find('[data-test=empty]').exists()).toBe(true)
    expect(wrapper!.findAll('[data-test=invitation]')).toHaveLength(0)
  })

  it('shows an error with retry when the list fails', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(500, 'boom', {}))
    await mountDirect(['owner'])
    expect(wrapper!.find('[data-test=load-failed]').exists()).toBe(true)
    get.mockResolvedValue({ data: [invitation(1, 'member')] })
    await wrapper!.find('button[name=retry]').trigger('click')
    await flushPromises()
    expect(wrapper!.findAll('[data-test=invitation]')).toHaveLength(1)
  })

  it('asks for confirmation, revokes and removes the row', async () => {
    mockGet(['owner'], [invitation(1, 'admin'), invitation(2, 'member')])
    const revoke = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never)
    await mountDirect(['owner'])
    await wrapper!.findAll('[data-test=revoke]')[0].trigger('click')
    await flushPromises()
    expect(dialogButton('confirm')).not.toBeNull()
    expect(document.querySelector('[data-test=confirm-text]')!.textContent).toContain('p1@e.com')
    expect(revoke).not.toHaveBeenCalled()
    dialogButton('confirm')!.click()
    await flushPromises()
    expect(revoke).toHaveBeenCalledWith('/api/invitations/1')
    expect(wrapper!.findAll('[data-test=email]').map((el) => el.text())).toEqual(['p2@e.com'])
    expect(toasts.value.map((item) => item.kind)).toEqual(['success'])
    expect(document.querySelector('[role=dialog]')).toBeNull()
  })

  it('cancelling keeps the invitation and does not call the API', async () => {
    mockGet(['owner'], [invitation(1, 'member')])
    const revoke = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never)
    await mountDirect(['owner'])
    await wrapper!.find('[data-test=revoke]').trigger('click')
    await flushPromises()
    expect(dialogButton('cancel')).not.toBeNull()
    dialogButton('cancel')!.click()
    await flushPromises()
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
    expect(wrapper!.findAll('[data-test=invitation]')).toHaveLength(1)
  })

  it('keeps the row and warns when revoking fails', async () => {
    mockGet(['owner'], [invitation(1, 'member')])
    vi.spyOn(api, 'delete').mockRejectedValue(new ApiError(500, 'boom', {}))
    await mountDirect(['owner'])
    await wrapper!.find('[data-test=revoke]').trigger('click')
    await flushPromises()
    dialogButton('confirm')!.click()
    await flushPromises()
    expect(wrapper!.findAll('[data-test=invitation]')).toHaveLength(1)
    expect(toasts.value.map((item) => item.kind)).toEqual(['error'])
  })

  it('drops the row when the invitation no longer exists (404)', async () => {
    mockGet(['owner'], [invitation(1, 'member')])
    vi.spyOn(api, 'delete').mockRejectedValue(new ApiError(404, 'gone', {}))
    await mountDirect(['owner'])
    await wrapper!.find('[data-test=revoke]').trigger('click')
    await flushPromises()
    dialogButton('confirm')!.click()
    await flushPromises()
    expect(wrapper!.findAll('[data-test=invitation]')).toHaveLength(0)
    expect(toasts.value.map((item) => item.kind)).toEqual(['info'])
  })

  it('an admin cannot revoke owner invitations but an owner can', async () => {
    mockGet(['admin'], [invitation(1, 'owner'), invitation(2, 'member')])
    await mountDirect(['admin'])
    expect(wrapper!.findAll('[data-test=invitation]')).toHaveLength(2)
    expect(wrapper!.findAll('[data-test=revoke]')).toHaveLength(1)
    wrapper!.unmount()
    document.body.innerHTML = ''
    mockGet(['owner'], [invitation(1, 'owner'), invitation(2, 'member')])
    await mountDirect(['owner'])
    expect(wrapper!.findAll('[data-test=revoke]')).toHaveLength(2)
  })

  it('a member is sent to projects without listing anything', async () => {
    const get = mockGet(['member'], [invitation(1, 'member')])
    const { router } = await mountDirect(['member'])
    expect(router.currentRoute.value.name).toBe('projects')
    expect(get).not.toHaveBeenCalledWith('/api/invitations', expect.anything())
    expect(wrapper!.find('[data-test=invitation]').exists()).toBe(false)
  })

  it('re-checks access when the active organization changes to one where the user is a member', async () => {
    const get = mockGet(['owner'], [invitation(1, 'member')])
    const { router, organization } = await mountDirect(['owner'])
    expect(wrapper!.findAll('[data-test=invitation]')).toHaveLength(1)
    await router.push('/settings/invitations')
    organization.organizations = [
      ...organization.organizations,
      { id: 2, name: 'Other', slug: 'other', settings: null, roles: ['member'] },
    ]
    organization.select(2)
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('projects')
    expect(wrapper!.findAll('[data-test=invitation]')).toHaveLength(0)
    expect(get.mock.calls.filter(([path]) => path === '/api/invitations')).toHaveLength(1)
  })

  it('opened directly with the organizations still loading, waits and then lists for an admin', async () => {
    let release: (value: unknown) => void = () => undefined
    const gate = new Promise((resolve) => (release = resolve))
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/me') return { data: user }
      if (path === '/api/organizations') {
        await gate
        return { data: organizationList(['admin']) }
      }
      if (path === '/api/invitations') return { data: [invitation(1, 'member')] }
      return { data: [] }
    })
    const { router } = await mountApp()
    expect(router.currentRoute.value.name).toBe('invitations')
    expect(document.body.textContent).not.toContain('p1@e.com')
    release(undefined)
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('invitations')
    expect(document.body.textContent).toContain('p1@e.com')
  })

  it('opened directly with the organizations still loading, sends a member to projects without listing', async () => {
    let release: (value: unknown) => void = () => undefined
    const gate = new Promise((resolve) => (release = resolve))
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/me') return { data: user }
      if (path === '/api/organizations') {
        await gate
        return { data: organizationList(['member']) }
      }
      return { data: [] }
    })
    const { router } = await mountApp()
    release(undefined)
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('projects')
    expect(get).not.toHaveBeenCalledWith('/api/invitations', expect.anything())
  })

  it('disables the invite button while the list loads and enables it afterwards', async () => {
    let release: (value: unknown) => void = () => undefined
    const gate = new Promise((resolve) => (release = resolve))
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/invitations') {
        await gate
        return { data: [] }
      }
      return { data: [] }
    })
    await mountDirect(['owner'])
    const button = () => wrapper!.find('[data-test=invite]')
    expect(button().attributes('disabled')).toBeDefined()
    release(undefined)
    await flushPromises()
    expect(button().attributes('disabled')).toBeUndefined()
  })
})
