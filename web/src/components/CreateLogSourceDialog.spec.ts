import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { api, ApiError } from '../api/client'
import { i18n } from '../i18n'
import { toast } from './ui/toast'
import CreateLogSourceDialog from './CreateLogSourceDialog.vue'

enableAutoUnmount(afterEach)

const created = { id: 9, project_id: 7, name: 'API', key_prefix: 'wsk_ab', last_used_at: null, revoked_at: null, created_at: '2026-10-08T12:00:00Z', key: 'wsk_full' }
const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)

function mountHost() {
  setActivePinia(createPinia())
  const open = ref(true)
  const mounted = ref(true)
  const onCreated = vi.fn()
  const host = defineComponent({
    render: () =>
      mounted.value
        ? h(CreateLogSourceDialog, {
            open: open.value,
            projectId: 7,
            'onUpdate:open': (v: boolean) => (open.value = v),
            onCreated,
          })
        : null,
  })
  const wrapper = mount(host, { attachTo: document.body, global: { plugins: [i18n] } })
  return { wrapper, open, mounted, onCreated }
}

async function type(value: string) {
  const el = q<HTMLInputElement>('#log-source-name')!
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function submit() {
  q<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await flushPromises()
}

describe('CreateLogSourceDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('posts the trimmed name, closes and emits the created source', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: created } as never)
    const { open, onCreated } = mountHost()
    await flushPromises()
    await type('  API  ')
    await submit()
    expect(post).toHaveBeenCalledWith('/api/projects/7/log-sources', { name: 'API' })
    expect(onCreated).toHaveBeenCalledWith(created)
    expect(open.value).toBe(false)
  })

  it('rejects an empty name and one over 255 characters without calling the API', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: created } as never)
    mountHost()
    await flushPromises()
    await type('   ')
    await submit()
    expect(q('[data-test=error-name]')!.textContent).toContain('required')
    await type('😀'.repeat(256))
    await submit()
    expect(q('[data-test=error-name]')!.textContent).toContain('255')
    expect(post).not.toHaveBeenCalled()
    await type('😀'.repeat(255))
    await submit()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('shows a 422 on name and an archived project error linked to the field', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid', { name: ['Taken.'], project: ['Archived.'] }))
    mountHost()
    await flushPromises()
    await type('API')
    await submit()
    const errors = [...document.body.querySelectorAll('[data-test=error-name]')]
    expect(errors.map((el) => el.textContent?.trim())).toEqual(['Taken.', 'Archived.'])
    const input = q<HTMLInputElement>('#log-source-name')!
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(errors.map((el) => el.id).join(' '))
    expect(q('[data-test=error-form]')).toBeNull()
  })

  it('shows the general error for a 422 without visible keys', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'Something invalid', { other: ['x'] }))
    mountHost()
    await flushPromises()
    await type('API')
    await submit()
    expect(q('[data-test=error-form]')!.textContent).toContain('Something invalid')
  })

  it('does not emit or close when unmounted with the request pending', async () => {
    let resolve: (value: unknown) => void = () => undefined
    vi.spyOn(api, 'post').mockImplementation(() => new Promise((r) => (resolve = r)) as never)
    const error = vi.spyOn(toast, 'error').mockReturnValue(1)
    const { mounted, open, onCreated } = mountHost()
    await flushPromises()
    await type('API')
    await submit()
    expect(error).not.toHaveBeenCalled()
    mounted.value = false
    await flushPromises()
    resolve({ data: created })
    await flushPromises()
    expect(onCreated).not.toHaveBeenCalled()
    expect(open.value).toBe(true)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toContain('"API"')
  })
})
