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

function invitation(id: number, role: 'owner' | 'admin' | 'member', email = `p${id}@e.com`) {
  return {
    id,
    email,
    role,
    locale: 'en',
    invited_by: { id: 1, name: 'Ada' },
    expires_at: '2026-10-15T12:00:00Z',
    created_at: '2026-10-08T12:00:00Z',
  }
}

let wrapper: VueWrapper | undefined

async function mountView(roles: string[], existing: unknown[] = []) {
  localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/api/invitations') return { data: existing }
    return { data: [] }
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().$patch({ user })
  const organization = useOrganizationStore()
  organization.$patch({
    organizations: [{ id: 1, name: 'Acme', slug: 'acme', settings: null, roles }],
    activeId: 1,
    loaded: true,
  })
  const router = createAppRouter(createMemoryHistory())
  await router.push('/settings/invitations').catch(() => undefined)
  wrapper = mount(InvitationsView, { attachTo: document.body, global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return { organization }
}

async function openDialog() {
  await wrapper!.find('[data-test=invite]').trigger('click')
  await flushPromises()
}

function dialog(): HTMLElement | null {
  return document.querySelector('[role=dialog]')
}

function field<T extends HTMLElement>(selector: string): T {
  return document.querySelector(`[role=dialog] ${selector}`) as T
}

async function fill(email: string, role?: string) {
  const input = field<HTMLInputElement>('input[name=email]')
  input.value = email
  input.dispatchEvent(new Event('input'))
  if (role) {
    const select = field<HTMLSelectElement>('select[name=role]')
    select.value = role
    select.dispatchEvent(new Event('change'))
  }
  await flushPromises()
}

async function submit() {
  field<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true }))
  await flushPromises()
}

function roleValues(): string[] {
  return [...document.querySelectorAll('[role=dialog] select[name=role] option')].map((o) => (o as HTMLOptionElement).value)
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

describe('InvitationsView invite dialog', () => {
  it('opens closed, then opens with the email focused and member selected', async () => {
    await mountView(['owner'])
    expect(dialog()).toBeNull()
    await openDialog()
    expect(dialog()).not.toBeNull()
    expect(field<HTMLSelectElement>('select[name=role]').value).toBe('member')
    expect(document.activeElement).toBe(field('input[name=email]'))
  })

  it('offers the owner role only to an owner', async () => {
    await mountView(['owner'])
    await openDialog()
    expect(roleValues()).toEqual(['member', 'admin', 'owner'])
    wrapper!.unmount()
    document.body.innerHTML = ''
    await mountView(['admin'])
    await openDialog()
    expect(roleValues()).toEqual(['member', 'admin'])
  })

  it('creates the invitation, toasts, closes and shows it in the list', async () => {
    await mountView(['owner'], [invitation(1, 'member')])
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: invitation(2, 'admin', 'new@e.com') })
    await openDialog()
    await fill(' new@e.com ', 'admin')
    await submit()
    expect(post).toHaveBeenCalledWith('/api/invitations', { email: 'new@e.com', role: 'admin' })
    expect(dialog()).toBeNull()
    expect(toasts.value.map((item) => item.kind)).toEqual(['success'])
    expect(wrapper!.findAll('[data-test=email]').map((el) => el.text())).toEqual(['new@e.com', 'p1@e.com'])
  })

  it('replaces the pending invitation of the same email', async () => {
    await mountView(['owner'], [invitation(1, 'member', 'Ada@e.com'), invitation(2, 'member')])
    vi.spyOn(api, 'post').mockResolvedValue({ data: invitation(3, 'admin', 'ada@e.com') })
    await openDialog()
    await fill('ada@e.com', 'admin')
    await submit()
    expect(wrapper!.findAll('[data-test=email]').map((el) => el.text())).toEqual(['ada@e.com', 'p2@e.com'])
    expect(wrapper!.findAll('[data-test=role]')[0].text()).toBe('Admin')
  })

  it('shows 422 errors per field and keeps the dialog open', async () => {
    await mountView(['owner'])
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid', { email: ['Bad email'], role: ['Bad role'] }))
    await openDialog()
    await fill('x')
    await submit()
    expect(dialog()).not.toBeNull()
    expect(field('[data-test=error-email]').textContent).toBe('Bad email')
    expect(field('[data-test=error-role]').textContent).toBe('Bad role')
    expect(field('input[name=email]').getAttribute('aria-invalid')).toBe('true')
    expect(field('input[name=email]').getAttribute('aria-describedby')).toBe('invite-email-error-0')
    expect(toasts.value).toHaveLength(0)
  })

  it('shows a 422 without field errors as a form message', async () => {
    await mountView(['owner'])
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'Something invalid', {}))
    await openDialog()
    await fill('x@e.com')
    await submit()
    expect(field('[data-test=error-form]').textContent).toBe('Something invalid')
  })

  it('shows a 403 as a message and keeps the dialog open', async () => {
    await mountView(['admin'])
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(403, 'forbidden', {}))
    await openDialog()
    await fill('x@e.com')
    await submit()
    expect(dialog()).not.toBeNull()
    expect(field('[data-test=error-form]').textContent).toBe('You are not allowed to invite with that role.')
  })

  it('shows a generic message on other failures', async () => {
    await mountView(['owner'])
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(500, 'boom', {}))
    await openDialog()
    await fill('x@e.com')
    await submit()
    expect(field('[data-test=error-form]').textContent).toBe('Could not send the invitation. Try again.')
  })

  it('cannot be cancelled while sending and does not send twice', async () => {
    await mountView(['owner'])
    let release: (value: unknown) => void = () => undefined
    const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise((resolve) => (release = resolve)))
    await openDialog()
    await fill('x@e.com')
    await submit()
    await submit()
    expect(post).toHaveBeenCalledTimes(1)
    expect(field<HTMLButtonElement>('[data-test=cancel]').disabled).toBe(true)
    expect(field<HTMLButtonElement>('[data-test=submit]').disabled).toBe(true)
    release({ data: invitation(5, 'member', 'x@e.com') })
    await flushPromises()
    expect(dialog()).toBeNull()
  })

  it('clears the previous input and errors when reopened', async () => {
    await mountView(['owner'])
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid', { email: ['Bad email'] }))
    await openDialog()
    await fill('x', 'admin')
    await submit()
    expect(field('[data-test=error-email]')).not.toBeNull()
    field<HTMLButtonElement>('[data-test=cancel]').click()
    await flushPromises()
    expect(dialog()).toBeNull()
    await openDialog()
    expect(field<HTMLInputElement>('input[name=email]').value).toBe('')
    expect(field<HTMLSelectElement>('select[name=role]').value).toBe('member')
    expect(field('[data-test=error-email]')).toBeNull()
  })

  it('discards the result when the organization changes while sending', async () => {
    const { organization } = await mountView(['owner'])
    let release: (value: unknown) => void = () => undefined
    vi.spyOn(api, 'post').mockImplementation(() => new Promise((resolve) => (release = resolve)))
    await openDialog()
    await fill('x@e.com')
    await submit()
    organization.$patch({
      organizations: [
        { id: 1, name: 'Acme', slug: 'acme', settings: null, roles: ['owner'] },
        { id: 2, name: 'Beta', slug: 'beta', settings: null, roles: ['owner'] },
      ],
      activeId: 2,
    })
    await flushPromises()
    release({ data: invitation(9, 'member', 'x@e.com') })
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(toasts.value).toHaveLength(0)
    expect(wrapper!.findAll('[data-test=email]').map((el) => el.text())).not.toContain('x@e.com')
  })
})
