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
    expect(input.getAttribute('aria-describedby')).toBe(['log-source-name-hint', ...errors.map((el) => el.id)].join(' '))
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

  describe('browser kind', () => {
    const browserCreated = { ...created, kind: 'browser', allowed_origins: ['https://app.example.com'], key: 'wsp_full' }

    async function chooseBrowser() {
      document.body.querySelectorAll<HTMLButtonElement>('[role=group] button')[1].click()
      await flushPromises()
    }

    async function addOrigin(value: string) {
      const el = q<HTMLInputElement>('#log-source-origin')!
      el.value = value
      el.dispatchEvent(new Event('input'))
      await flushPromises()
      q<HTMLButtonElement>('[data-test=add-origin]')!.click()
      await flushPromises()
    }

    it('hides the origins until the browser kind is chosen', async () => {
      mountHost()
      await flushPromises()
      expect(q('[data-test=origins]')).toBeNull()
      await chooseBrowser()
      expect(q('[data-test=origins]')).not.toBeNull()
    })

    it('posts kind and normalized origins, and lets an origin be removed', async () => {
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: browserCreated } as never)
      const { onCreated } = mountHost()
      await flushPromises()
      await type('Web')
      await chooseBrowser()
      await addOrigin('HTTPS://App.Example.com:443')
      await addOrigin('http://localhost:5173')
      await addOrigin('https://app.example.com')
      expect([...document.body.querySelectorAll('[data-test=origin] code')].map((el) => el.textContent)).toEqual([
        'https://app.example.com',
        'http://localhost:5173',
      ])
      q<HTMLButtonElement>('[data-test=remove-origin]')!.click()
      await flushPromises()
      await addOrigin('https://other.example.com')
      await submit()
      expect(post).toHaveBeenCalledWith('/api/projects/7/log-sources', {
        name: 'Web',
        kind: 'browser',
        allowed_origins: ['http://localhost:5173', 'https://other.example.com'],
      })
      expect(onCreated).toHaveBeenCalledWith(browserCreated)
    })

    it('adds a pending origin typed but not added when submitting', async () => {
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: browserCreated } as never)
      mountHost()
      await flushPromises()
      await type('Web')
      await chooseBrowser()
      const el = q<HTMLInputElement>('#log-source-origin')!
      el.value = 'https://app.example.com'
      el.dispatchEvent(new Event('input'))
      await submit()
      expect(post).toHaveBeenCalledWith('/api/projects/7/log-sources', {
        name: 'Web',
        kind: 'browser',
        allowed_origins: ['https://app.example.com'],
      })
    })

    it.each([
      'example.com',
      'http://example.com',
      'https://example.com/',
      'https://example.com/path',
      'https://user@example.com',
      'https://example.com:70000',
      'https://example.com:0',
      'ftp://example.com',
    ])('rejects the invalid origin %s without adding it', async (value) => {
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: browserCreated } as never)
      mountHost()
      await flushPromises()
      await type('Web')
      await chooseBrowser()
      await addOrigin(value)
      expect(q('[data-test=error-origin-draft]')!.textContent).toContain('exact origin')
      expect(document.body.querySelectorAll('[data-test=origin]')).toHaveLength(0)
      await submit()
      expect(post).not.toHaveBeenCalled()
    })

    it('accepts localhost and 127.0.0.1 over http', async () => {
      mountHost()
      await flushPromises()
      await chooseBrowser()
      await addOrigin('http://localhost')
      await addOrigin('http://127.0.0.1:8080')
      expect(document.body.querySelectorAll('[data-test=origin]')).toHaveLength(2)
      expect(q('[data-test=error-origin-draft]')).toBeNull()
    })

    it('requires at least one origin and caps them at 20', async () => {
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: browserCreated } as never)
      mountHost()
      await flushPromises()
      await type('Web')
      await chooseBrowser()
      await submit()
      expect(q('[data-test=error-origins]')!.textContent).toContain('at least one')
      for (let i = 0; i < 20; i++) await addOrigin(`https://a${i}.example.com`)
      await addOrigin('https://extra.example.com')
      expect(document.body.querySelectorAll('[data-test=origin]')).toHaveLength(20)
      expect(q('[data-test=error-origin-draft]')!.textContent).toContain('20')
      expect(post).not.toHaveBeenCalled()
    })

    it('shows the API 422 under the origin at that index', async () => {
      vi.spyOn(api, 'post').mockRejectedValue(
        new ApiError(422, 'invalid', { 'allowed_origins.1': ['Each allowed origin must be exact.'] }),
      )
      mountHost()
      await flushPromises()
      await type('Web')
      await chooseBrowser()
      await addOrigin('https://a.example.com')
      await addOrigin('https://b.example.com')
      await submit()
      const items = document.body.querySelectorAll('[data-test=origin]')
      expect(items[0].querySelector('[data-test=error-origin-0]')).toBeNull()
      expect(items[1].querySelector('[data-test=error-origin-1]')!.textContent).toContain('must be exact')
      expect(q('[data-test=error-form]')).toBeNull()
    })

    it('shows a list-level 422 on allowed_origins', async () => {
      vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'invalid', { allowed_origins: ['Too many.'] }))
      mountHost()
      await flushPromises()
      await type('Web')
      await chooseBrowser()
      await addOrigin('https://a.example.com')
      await submit()
      expect(q('[data-test=error-origins]')!.textContent).toContain('Too many.')
    })

    it('goes back to server and sends only the name', async () => {
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: created } as never)
      mountHost()
      await flushPromises()
      await type('Web')
      await chooseBrowser()
      await addOrigin('https://a.example.com')
      document.body.querySelectorAll<HTMLButtonElement>('[role=group] button')[0].click()
      await flushPromises()
      await submit()
      expect(post).toHaveBeenCalledWith('/api/projects/7/log-sources', { name: 'Web' })
    })
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
