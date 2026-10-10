import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { ApiError } from '../api/client'
import { i18n } from '../i18n'
import { useOrganizationStore } from '../stores/organization'
import OrganizationCreateDialog from './OrganizationCreateDialog.vue'
import { toast } from './ui/toast'

enableAutoUnmount(afterEach)

const org = { id: 7, name: 'Acme', slug: 'acme', role: 'owner' }
const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)

function mountHost() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const create = vi.spyOn(useOrganizationStore(), 'create').mockResolvedValue(org as never)
  const open = ref(false)
  const mounted = ref(true)
  const created = vi.fn()
  const host = defineComponent({
    render: () =>
      h('div', [
        h('button', { id: 'opener', onClick: () => (open.value = true) }, 'open'),
        mounted.value
          ? h(OrganizationCreateDialog, { open: open.value, 'onUpdate:open': (v: boolean) => (open.value = v), onCreated: created })
          : null,
      ]),
  })
  const wrapper = mount(host, { attachTo: document.body, global: { plugins: [pinia, i18n] } })
  return { wrapper, open, mounted, created, create }
}

async function openIt(wrapper: ReturnType<typeof mountHost>['wrapper']) {
  const button = wrapper.get('#opener')
  ;(button.element as HTMLElement).focus()
  await button.trigger('click')
  await flushPromises()
}

async function type(value: string) {
  const el = q<HTMLInputElement>('#org-create-name')!
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function submit() {
  q<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await flushPromises()
}

describe('OrganizationCreateDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('focuses the name, creates the organization, emits created, toasts and closes', async () => {
    const success = vi.spyOn(toast, 'success').mockReturnValue(undefined as never)
    const { wrapper, open, created, create } = mountHost()
    await openIt(wrapper)
    expect(document.activeElement).toBe(q('#org-create-name'))
    await type('  Acme ')
    await submit()
    expect(create).toHaveBeenCalledWith('Acme')
    expect(created).toHaveBeenCalledWith(org)
    expect(success).toHaveBeenCalledWith(expect.stringContaining('Acme'))
    expect(open.value).toBe(false)
  })

  it('rejects an empty name without calling the store', async () => {
    const { wrapper, create } = mountHost()
    await openIt(wrapper)
    await submit()
    expect(q('[data-test=error-name]')!.textContent).toContain('Enter a name')
    expect(q('#org-create-name')!.getAttribute('aria-invalid')).toBe('true')
    expect(q('#org-create-name')!.getAttribute('aria-describedby')).toBe('org-create-name-error-0')
    expect(create).not.toHaveBeenCalled()
  })

  it('shows 422 field errors linked to the field and keeps the dialog open', async () => {
    const { wrapper, open, create } = mountHost()
    create.mockRejectedValue(new ApiError(422, 'bad', { name: ['Bad name'] }))
    await openIt(wrapper)
    await type('Acme')
    await submit()
    expect(q('[data-test=error-name]')!.textContent).toBe('Bad name')
    expect(q('#org-create-name')!.getAttribute('aria-invalid')).toBe('true')
    expect(q('[data-test=error-form]')).toBeNull()
    expect(open.value).toBe(true)
  })

  it('shows the general error when a 422 has no painted key (L-47)', async () => {
    const { wrapper, create } = mountHost()
    create.mockRejectedValue(new ApiError(422, 'Unprocessable', { other: ['x'] }))
    await openIt(wrapper)
    await type('Acme')
    await submit()
    expect(q('[data-test=error-form]')!.textContent).toBe('Unprocessable')
    expect(q('[data-test=error-name]')).toBeNull()
  })

  it('shows generic messages for 429, network and other failures', async () => {
    const { wrapper, create } = mountHost()
    create.mockRejectedValueOnce(new ApiError(429, 'Too Many Attempts.'))
    await openIt(wrapper)
    await type('Acme')
    await submit()
    expect(q('[data-test=error-form]')!.textContent).toContain('Too many attempts')
    create.mockRejectedValueOnce(new ApiError(0, 'network'))
    await submit()
    expect(q('[data-test=error-form]')!.textContent).toContain('Could not reach')
    create.mockRejectedValueOnce(new ApiError(500, 'boom'))
    await submit()
    expect(q('[data-test=error-form]')!.textContent).toContain('Could not create')
  })

  it('does not close while submitting and ignores a second submit', async () => {
    const { wrapper, open, create } = mountHost()
    let resolve!: (value: never) => void
    create.mockReturnValue(new Promise((r) => (resolve = r)) as never)
    await openIt(wrapper)
    await type('Acme')
    await submit()
    expect(q<HTMLButtonElement>('[data-test=submit]')!.disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-test=cancel]')!.disabled).toBe(true)
    q<HTMLButtonElement>('[data-test=cancel]')!.click()
    await submit()
    await flushPromises()
    expect(open.value).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
    resolve(org as never)
    await flushPromises()
    expect(open.value).toBe(false)
  })

  it('does nothing after unmount with the request pending', async () => {
    const success = vi.spyOn(toast, 'success').mockReturnValue(undefined as never)
    const { wrapper, mounted, created, create } = mountHost()
    let resolve!: (value: never) => void
    create.mockReturnValue(new Promise((r) => (resolve = r)) as never)
    await openIt(wrapper)
    await type('Acme')
    await submit()
    mounted.value = false
    await flushPromises()
    resolve(org as never)
    await flushPromises()
    expect(created).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
  })

  it('reopens clean after a cancel and returns focus to the opener', async () => {
    const { wrapper, open } = mountHost()
    await openIt(wrapper)
    await type('changed')
    q<HTMLButtonElement>('[data-test=cancel]')!.click()
    await flushPromises()
    expect(open.value).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('#opener').element)
    await openIt(wrapper)
    expect(q<HTMLInputElement>('#org-create-name')!.value).toBe('')
  })
})
