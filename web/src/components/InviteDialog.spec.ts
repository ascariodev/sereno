import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { ApiError } from '../api/client'
import * as invitationsApi from '../api/invitations'
import { i18n } from '../i18n'
import { useProjectsStore } from '../stores/projects'
import InviteDialog from './InviteDialog.vue'
import { toast } from './ui/toast'

enableAutoUnmount(afterEach)

const invitation = {
  id: 3,
  email: 'new@e.com',
  role: 'member',
  locale: 'en',
  invited_by: null,
  projects: [],
  expires_at: '2026-10-20T00:00:00Z',
  created_at: '2026-10-12T00:00:00Z',
}
const projects = [
  { id: 8, name: 'Posve API', key: 'POSVEAPI', description: null },
  { id: 9, name: 'Web', key: 'WEB', description: null },
]
const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)
const t = (key: string) => i18n.global.t(key)

function mountHost(options: { isOwner?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useProjectsStore()
  store.projects = projects as never
  const create = vi.spyOn(invitationsApi, 'createInvitation').mockResolvedValue(invitation as never)
  const open = ref(false)
  const isOwner = ref(options.isOwner ?? false)
  const created = vi.fn()
  const host = defineComponent({
    render: () =>
      h('div', [
        h('button', { id: 'opener', onClick: () => (open.value = true) }, 'open'),
        h(InviteDialog, {
          isOwner: isOwner.value,
          open: open.value,
          'onUpdate:open': (v: boolean) => (open.value = v),
          onCreated: created,
        }),
      ]),
  })
  const wrapper = mount(host, { attachTo: document.body, global: { plugins: [pinia, i18n] } })
  return { wrapper, open, isOwner, created, create, store }
}

async function openIt(wrapper: ReturnType<typeof mountHost>['wrapper']) {
  await wrapper.get('#opener').trigger('click')
  await flushPromises()
}

async function type(selector: string, value: string) {
  const el = q<HTMLInputElement>(selector)!
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function choose(value: string) {
  const el = q<HTMLSelectElement>('#invite-role')!
  el.value = value
  el.dispatchEvent(new Event('change'))
  await flushPromises()
}

async function submit() {
  q<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await flushPromises()
}

const roleValues = () => Array.from(q<HTMLSelectElement>('#invite-role')!.options).map((o) => o.value)

describe('InviteDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('focuses the email on open and offers owner only to owners', async () => {
    const { wrapper } = mountHost()
    await openIt(wrapper)
    expect(document.activeElement).toBe(q('#invite-email'))
    expect(q<HTMLSelectElement>('#invite-role')!.value).toBe('member')
    expect(roleValues()).toEqual(['member', 'admin'])
    expect(q('#invite-email')!.hasAttribute('aria-describedby')).toBe(false)
    expect(q('#invite-role')!.hasAttribute('aria-invalid')).toBe(false)
  })

  it('offers the owner role to owners', async () => {
    const { wrapper } = mountHost({ isOwner: true })
    await openIt(wrapper)
    expect(roleValues()).toEqual(['member', 'admin', 'owner'])
    expect(q<HTMLSelectElement>('#invite-role')!.value).toBe('member')
  })

  it('falls back to member when the selected role stops being offered', async () => {
    const { wrapper, isOwner } = mountHost({ isOwner: true })
    await openIt(wrapper)
    await choose('owner')
    expect(q<HTMLSelectElement>('#invite-role')!.value).toBe('owner')
    isOwner.value = false
    await flushPromises()
    expect(roleValues()).toEqual(['member', 'admin'])
    expect(q<HTMLSelectElement>('#invite-role')!.value).toBe('member')
    expect(q('[data-test=projects]')).not.toBeNull()
  })

  it('sends the invitation with the checked projects, emits, toasts and closes', async () => {
    const success = vi.spyOn(toast, 'success').mockReturnValue(undefined as never)
    const { wrapper, open, created, create } = mountHost()
    await openIt(wrapper)
    await type('#invite-email', '  new@e.com ')
    const boxes = document.body.querySelectorAll<HTMLInputElement>('[data-test=projects] input[type=checkbox]')
    expect(boxes).toHaveLength(2)
    boxes[1]!.click()
    await flushPromises()
    boxes[0]!.click()
    await flushPromises()
    await submit()
    expect(create).toHaveBeenCalledWith('new@e.com', 'member', [8, 9])
    expect(created).toHaveBeenCalledWith(invitation)
    expect(success).toHaveBeenCalledWith(expect.stringContaining('new@e.com'))
    expect(open.value).toBe(false)
  })

  it('hides the projects for other roles and sends the chosen role', async () => {
    const { wrapper, create } = mountHost()
    await openIt(wrapper)
    await type('#invite-email', 'new@e.com')
    await choose('admin')
    expect(q('[data-test=projects]')).toBeNull()
    await submit()
    expect(create).toHaveBeenCalledWith('new@e.com', 'admin', [])
  })

  it('shows 422 errors under each field with their ids and ARIA', async () => {
    const { wrapper, open, create } = mountHost()
    create.mockRejectedValue(
      new ApiError(422, 'bad', {
        email: ['Email taken.', 'Email invalid.'],
        role: ['Bad role.'],
        'project_ids.0': ['Bad project.'],
      }),
    )
    await openIt(wrapper)
    await type('#invite-email', 'new@e.com')
    await submit()
    const emailErrors = document.body.querySelectorAll('[data-test=error-email]')
    expect(Array.from(emailErrors).map((e) => e.id)).toEqual(['invite-email-error-0', 'invite-email-error-1'])
    expect(emailErrors[0]!.textContent).toContain('Email taken.')
    expect(q('#invite-email')!.getAttribute('aria-invalid')).toBe('true')
    expect(q('#invite-email')!.getAttribute('aria-describedby')).toBe('invite-email-error-0 invite-email-error-1')
    expect(q('[data-test=error-role]')!.id).toBe('invite-role-error-0')
    expect(q('[data-test=error-role]')!.textContent).toContain('Bad role.')
    expect(q('#invite-role')!.getAttribute('aria-invalid')).toBe('true')
    expect(q('#invite-role')!.getAttribute('aria-describedby')).toBe('invite-role-error-0')
    expect(q('[data-test=error-projects]')!.id).toBe('invite-project_ids-error-0')
    expect(q('[data-test=projects]')!.getAttribute('aria-describedby')).toBe('invite-project_ids-error-0')
    expect(q('[data-test=projects]')!.getAttribute('aria-invalid')).toBe('true')
    expect(q('[data-test=error-form]')).toBeNull()
    expect(open.value).toBe(true)
  })

  it('shows a general error when the 422 has no field errors', async () => {
    const { wrapper, create } = mountHost()
    create.mockRejectedValue(new ApiError(422, 'Something went wrong.', {}))
    await openIt(wrapper)
    await submit()
    expect(q('[data-test=error-form]')!.getAttribute('role')).toBe('alert')
    expect(q('[data-test=error-form]')!.textContent).toContain('Something went wrong.')
    expect(q('[data-test=error-email]')).toBeNull()
  })

  it('maps 403, 429, network and other failures to the general error', async () => {
    const { wrapper, create } = mountHost()
    await openIt(wrapper)
    const cases: [ApiError, string][] = [
      [new ApiError(403, 'x'), 'inviteDialog.forbidden'],
      [new ApiError(429, 'x'), 'inviteDialog.tooManyAttempts'],
      [new ApiError(0, 'x'), 'inviteDialog.network'],
      [new ApiError(500, 'x'), 'inviteDialog.failed'],
    ]
    for (const [error, key] of cases) {
      create.mockRejectedValueOnce(error)
      await submit()
      expect(q('[data-test=error-form]')!.textContent).toContain(t(key))
    }
  })

  it('disables the actions while sending', async () => {
    const { wrapper, create } = mountHost()
    let resolve!: (value: never) => void
    create.mockImplementation(() => new Promise((r) => (resolve = r)))
    await openIt(wrapper)
    await submit()
    expect(q<HTMLButtonElement>('[data-test=submit]')!.disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-test=cancel]')!.disabled).toBe(true)
    expect(q('[data-test=submit]')!.textContent).toContain(t('inviteDialog.sending'))
    resolve(invitation as never)
    await flushPromises()
  })

  it('closes with cancel', async () => {
    const { wrapper, open } = mountHost()
    await openIt(wrapper)
    expect(q('form')).not.toBeNull()
    q<HTMLButtonElement>('[data-test=cancel]')!.click()
    await flushPromises()
    expect(open.value).toBe(false)
  })

  it('retries loading the projects when they failed, only for members', async () => {
    const { wrapper, store } = mountHost()
    store.projects = []
    store.failed = true
    const refresh = vi.spyOn(store, 'refresh').mockResolvedValue()
    await openIt(wrapper)
    expect(q('[data-test=projects-failed]')!.getAttribute('role')).toBe('alert')
    expect(q('[data-test=projects]')).toBeNull()
    q<HTMLButtonElement>('[data-test=projects-retry]')!.click()
    expect(refresh).toHaveBeenCalledTimes(1)
    store.loading = true
    await flushPromises()
    expect(q<HTMLButtonElement>('[data-test=projects-retry]')!.disabled).toBe(true)
    await choose('admin')
    expect(q('[data-test=projects-failed]')).toBeNull()
  })
})
