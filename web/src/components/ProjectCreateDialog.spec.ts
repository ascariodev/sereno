import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { i18n } from '../i18n'
import { useProjectsStore } from '../stores/projects'
import ProjectCreateDialog from './ProjectCreateDialog.vue'
import { toast } from './ui/toast'

enableAutoUnmount(afterEach)

const project = { id: 5, name: 'Posve API', key: 'POSVEAPI', description: null }
const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)

function mountHost() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'projects', component: { render: () => null } },
      { path: '/channels/:id', name: 'channel', component: { render: () => null } },
    ],
  })
  const push = vi.spyOn(router, 'push').mockResolvedValue(undefined)
  const store = useProjectsStore()
  const create = vi.spyOn(store, 'create').mockImplementation(async () => {
    store.channelByProject = { 5: 42 }
    return project as never
  })
  const open = ref(false)
  const mounted = ref(true)
  const created = vi.fn()
  const host = defineComponent({
    render: () =>
      h('div', [
        h('button', { id: 'opener', onClick: () => (open.value = true) }, 'open'),
        mounted.value
          ? h(ProjectCreateDialog, { open: open.value, 'onUpdate:open': (v: boolean) => (open.value = v), onCreated: created })
          : null,
      ]),
  })
  const wrapper = mount(host, { attachTo: document.body, global: { plugins: [pinia, i18n, router] } })
  return { wrapper, open, mounted, created, create, push, store }
}

async function openIt(wrapper: ReturnType<typeof mountHost>['wrapper']) {
  const button = wrapper.get('#opener')
  ;(button.element as HTMLElement).focus()
  await button.trigger('click')
  await flushPromises()
}

async function type(selector: string, value: string) {
  const el = q<HTMLInputElement | HTMLTextAreaElement>(selector)!
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function submit() {
  q<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await flushPromises()
}

describe('ProjectCreateDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('suggests the key from the name until it is edited by hand', async () => {
    const { wrapper } = mountHost()
    await openIt(wrapper)
    expect(document.activeElement).toBe(q('#proj-create-name'))
    await type('#proj-create-name', 'Posve API')
    expect(q<HTMLInputElement>('#proj-create-key')!.value).toBe('POSVEAPI')
    await type('#proj-create-name', 'Ñandú 2 largo nombre')
    expect(q<HTMLInputElement>('#proj-create-key')!.value).toBe('NANDU2LARG')
    await type('#proj-create-key', 'abc')
    expect(q<HTMLInputElement>('#proj-create-key')!.value).toBe('ABC')
    await type('#proj-create-name', 'Otro')
    expect(q<HTMLInputElement>('#proj-create-key')!.value).toBe('ABC')
    await type('#proj-create-key', '')
    expect(q<HTMLInputElement>('#proj-create-key')!.value).toBe('OTRO')
  })

  it('creates the project, emits, toasts, closes and navigates to its channel', async () => {
    const success = vi.spyOn(toast, 'success').mockReturnValue(undefined as never)
    const { wrapper, open, created, create, push } = mountHost()
    await openIt(wrapper)
    await type('#proj-create-name', '  Posve API ')
    await type('#proj-create-description', '  Logs  ')
    await submit()
    expect(create).toHaveBeenCalledWith({ name: 'Posve API', key: 'POSVEAPI', description: 'Logs' })
    expect(created).toHaveBeenCalledWith(project)
    expect(success).toHaveBeenCalledWith(expect.stringContaining('Posve API'))
    expect(push).toHaveBeenCalledWith({ name: 'channel', params: { id: 42 } })
    expect(open.value).toBe(false)
  })

  it('falls back to the projects list when the channel is not in the store', async () => {
    const { wrapper, create, push } = mountHost()
    create.mockResolvedValue(project as never)
    await openIt(wrapper)
    await type('#proj-create-name', 'Posve API')
    await submit()
    expect(create).toHaveBeenCalledWith({ name: 'Posve API', key: 'POSVEAPI', description: null })
    expect(push).toHaveBeenCalledWith({ name: 'projects' })
  })

  it('validates name and key locally with ARIA and does not call the store', async () => {
    const { wrapper, create } = mountHost()
    await openIt(wrapper)
    await submit()
    expect(q('[data-test=error-name]')!.textContent).toContain('Enter a name')
    expect(q('#proj-create-name')!.getAttribute('aria-describedby')).toBe('proj-create-name-error-0')
    expect(q('[data-test=error-key]')!.textContent).toContain('starts with a letter')
    expect(q('#proj-create-key')!.getAttribute('aria-invalid')).toBe('true')
    await type('#proj-create-name', '1')
    await type('#proj-create-key', 'A')
    await submit()
    expect(q('[data-test=error-key]')).not.toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it('counts the description limit in characters, not UTF-16 units (L-11)', async () => {
    const { wrapper, create } = mountHost()
    await openIt(wrapper)
    await type('#proj-create-name', 'Posve')
    await type('#proj-create-description', '😀'.repeat(5001))
    await submit()
    expect(q('[data-test=error-description]')!.textContent).toContain('5000')
    expect(create).not.toHaveBeenCalled()
    await type('#proj-create-description', '😀'.repeat(5000))
    await submit()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('shows a duplicated key 422 on the key field and keeps the dialog open', async () => {
    const { wrapper, open, create, push } = mountHost()
    create.mockRejectedValue(new ApiError(422, 'bad', { key: ['A project with this key already exists in the organization.'] }))
    await openIt(wrapper)
    await type('#proj-create-name', 'Posve')
    await submit()
    expect(q('[data-test=error-key]')!.textContent).toContain('already exists')
    expect(q('#proj-create-key')!.getAttribute('aria-invalid')).toBe('true')
    expect(q('#proj-create-key')!.getAttribute('aria-describedby')).toBe('proj-create-key-error-0')
    expect(q('[data-test=error-form]')).toBeNull()
    expect(open.value).toBe(true)
    expect(push).not.toHaveBeenCalled()
  })

  it('shows the general error when a 422 has no painted key (L-47)', async () => {
    const { wrapper, create } = mountHost()
    create.mockRejectedValue(new ApiError(422, 'Unprocessable', { other: ['x'] }))
    await openIt(wrapper)
    await type('#proj-create-name', 'Posve')
    await submit()
    expect(q('[data-test=error-form]')!.textContent).toBe('Unprocessable')
  })

  it('shows messages for 403, 429, network and other failures', async () => {
    const { wrapper, create } = mountHost()
    create.mockRejectedValueOnce(new ApiError(403, 'Forbidden'))
    await openIt(wrapper)
    await type('#proj-create-name', 'Posve')
    await submit()
    expect(q('[data-test=error-form]')!.textContent).toContain('Only owners and admins')
    create.mockRejectedValueOnce(new ApiError(429, 'Too Many Attempts.'))
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
    await type('#proj-create-name', 'Posve')
    await submit()
    expect(q<HTMLButtonElement>('[data-test=submit]')!.disabled).toBe(true)
    q<HTMLButtonElement>('[data-test=cancel]')!.click()
    await submit()
    expect(open.value).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
    resolve(project as never)
    await flushPromises()
    expect(open.value).toBe(false)
  })

  it('does nothing after unmount with the request pending', async () => {
    const success = vi.spyOn(toast, 'success').mockReturnValue(undefined as never)
    const { wrapper, mounted, created, create, push } = mountHost()
    let resolve!: (value: never) => void
    create.mockReturnValue(new Promise((r) => (resolve = r)) as never)
    await openIt(wrapper)
    await type('#proj-create-name', 'Posve')
    await submit()
    mounted.value = false
    await flushPromises()
    resolve(project as never)
    await flushPromises()
    expect(created).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('reopens clean after a cancel and returns focus to the opener', async () => {
    const { wrapper, open } = mountHost()
    await openIt(wrapper)
    await type('#proj-create-name', 'changed')
    q<HTMLButtonElement>('[data-test=cancel]')!.click()
    await flushPromises()
    expect(open.value).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('#opener').element)
    await openIt(wrapper)
    expect(q<HTMLInputElement>('#proj-create-name')!.value).toBe('')
    expect(q<HTMLInputElement>('#proj-create-key')!.value).toBe('')
  })
})
