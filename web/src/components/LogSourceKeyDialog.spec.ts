import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import type { LogSourceWithKey } from '../api/types'
import { config } from '../config'
import { i18n } from '../i18n'
import LogSourceKeyDialog from './LogSourceKeyDialog.vue'
import { toast } from './ui/toast'

enableAutoUnmount(afterEach)

const issued: LogSourceWithKey = {
  id: 7,
  project_id: 3,
  name: 'posveapi',
  kind: 'server',
  allowed_origins: null,
  key_prefix: 'wsk_abcd',
  last_used_at: null,
  revoked_at: null,
  created_at: '2026-10-10T12:00:00Z',
  key: 'wsk_abcdSECRETSECRETSECRET',
}
const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)

function mountHost() {
  const source = ref<LogSourceWithKey | null>({ ...issued })
  const host = defineComponent({
    render: () => h(LogSourceKeyDialog, { source: source.value, 'onUpdate:source': (value: LogSourceWithKey | null) => (source.value = value) }),
  })
  mount(host, { attachTo: document.body, global: { plugins: [i18n] } })
  return source
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LogSourceKeyDialog', () => {
  async function chooseTab(label: string) {
    const button = [...document.body.querySelectorAll<HTMLButtonElement>('[role=group] button')].find(
      (el) => el.textContent?.trim() === label,
    )!
    button.click()
    await flushPromises()
  }

  const tabLabels = () =>
    [...document.body.querySelectorAll('[role=group] button')].map((el) => el.textContent?.trim())
  const env = `SERENO_KEY=${issued.key}\nSERENO_URL=${config.apiUrl}`

  it('shows the key, the warning and the endpoint from config.apiUrl', async () => {
    mountHost()
    await flushPromises()
    expect(q('[data-test="warning"]')).not.toBeNull()
    expect(q('[data-test="key"]')?.textContent).toBe(issued.key)
    expect(q('[data-test="endpoint"]')?.textContent).toBe(`${config.apiUrl}/api/ingest/events`)
  })

  it('offers every tab but Browser for a server source, with Laravel first', async () => {
    mountHost()
    await flushPromises()
    expect(tabLabels()).toEqual(['Laravel', 'PHP', 'Node.js', 'Python', 'curl'])
    expect(q('[data-test="install"]')?.textContent).toBe(
      `composer require ascariodev/sereno-laravel && php artisan sereno:install ${issued.key} --url=${config.apiUrl}`,
    )
    expect(q('[data-test="env"]')?.textContent).toBe(env)
    expect(q('[data-test="origin-notice"]')).toBeNull()
  })

  it('PHP tab interpolates the env block and installs ascariodev/sereno-php', async () => {
    mountHost()
    await flushPromises()
    await chooseTab('PHP')
    expect(q('[data-test="install"]')?.textContent).toBe('composer require ascariodev/sereno-php')
    expect(q('[data-test="env"]')?.textContent).toBe(env)
    expect(q('[data-test="code"]')?.textContent).toContain('Sereno::init()')
  })

  it('Node.js tab interpolates the env block and installs @ascariodev/sereno-node', async () => {
    mountHost()
    await flushPromises()
    await chooseTab('Node.js')
    expect(q('[data-test="install"]')?.textContent).toBe('npm install @ascariodev/sereno-node')
    expect(q('[data-test="env"]')?.textContent).toBe(env)
    expect(q('[data-test="code"]')?.textContent).toContain("from '@ascariodev/sereno-node'")
  })

  it('Python tab interpolates the env block and installs sereno-sdk', async () => {
    mountHost()
    await flushPromises()
    await chooseTab('Python')
    expect(q('[data-test="install"]')?.textContent).toBe('pip install sereno-sdk')
    expect(q('[data-test="env"]')?.textContent).toBe(env)
    expect(q('[data-test="code"]')?.textContent).toContain('sereno.init()')
  })

  it('curl tab interpolates the key and the endpoint', async () => {
    mountHost()
    await flushPromises()
    await chooseTab('curl')
    expect(q('[data-test="curl"]')?.textContent).toBe(
      `curl -X POST ${config.apiUrl}/api/ingest/events \\\n` +
        `  -H "Authorization: Bearer ${issued.key}" \\\n` +
        `  -H "Content-Type: application/json" \\\n` +
        `  -d '{"events":[{"level":"error","message":"Test event"}]}'`,
    )
  })

  it('shows only the Browser tab for a browser source, with the key, the url and the origin notice', async () => {
    const source = ref<LogSourceWithKey | null>({
      ...issued,
      kind: 'browser',
      allowed_origins: ['https://app.example.com'],
      key: 'wsp_PUBLICKEY',
    })
    mount(
      defineComponent({
        render: () =>
          h(LogSourceKeyDialog, { source: source.value, 'onUpdate:source': (v: LogSourceWithKey | null) => (source.value = v) }),
      }),
      { attachTo: document.body, global: { plugins: [i18n] } },
    )
    await flushPromises()
    expect(tabLabels()).toEqual(['Browser'])
    expect(q('[data-test="install"]')?.textContent).toBe('npm install @ascariodev/sereno-browser')
    const code = q('[data-test="code"]')!.textContent!
    expect(code).toContain(`url: '${config.apiUrl}'`)
    expect(code).toContain("key: 'wsp_PUBLICKEY'")
    expect(q('[data-test="vue"]')?.textContent).toContain('SerenoVue')
    expect(q('[data-test="env"]')).toBeNull()
    expect(q('[data-test="curl"]')).toBeNull()
    expect(q('[data-test="origin-notice"]')?.textContent).toContain('https://app.example.com')
  })

  it('copies the exact text of each block of the active tab', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    vi.spyOn(toast, 'success').mockReturnValue(0)
    mountHost()
    await flushPromises()
    await chooseTab('Node.js')
    const buttons = [...document.body.querySelectorAll<HTMLButtonElement>('.copy-button')]
    expect(buttons).toHaveLength(5)
    for (const button of buttons) button.click()
    await flushPromises()
    expect(writeText.mock.calls.map((call) => call[0])).toEqual([
      issued.key,
      `${config.apiUrl}/api/ingest/events`,
      'npm install @ascariodev/sereno-node',
      env,
      q('[data-test="code"]')?.textContent,
    ])
  })

  it('drops the key from the state when closed', async () => {
    const source = mountHost()
    await flushPromises()
    expect(q('[data-test="key"]')).not.toBeNull()
    q<HTMLButtonElement>('[data-test="done"]')?.click()
    await flushPromises()
    expect(source.value).toBeNull()
    expect(document.body.textContent).not.toContain(issued.key)
  })

  it('drops the key when closed with Escape', async () => {
    const source = mountHost()
    await flushPromises()
    expect(q('[data-test="key"]')).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(source.value).toBeNull()
  })

  it('waits for the first event in a polite live region and then shows connected in the same region', async () => {
    const source = mountHost()
    await flushPromises()
    const status = q('[data-test="status"]')!
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.getAttribute('aria-atomic')).toBe('true')
    expect(status.textContent?.trim()).toBe('Waiting for the first event…')
    source.value = { ...issued, last_used_at: '2026-10-10T12:00:00.000000Z' }
    await flushPromises()
    expect(q('[data-test="status"]')).toBe(status)
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent?.trim()).toBe('Connected')
  })

  it('shows connected right away when the source already has a last use', async () => {
    const source = ref<LogSourceWithKey | null>({ ...issued, last_used_at: '2026-10-10T12:00:00Z' })
    const host = defineComponent({
      render: () => h(LogSourceKeyDialog, { source: source.value, 'onUpdate:source': (value: LogSourceWithKey | null) => (source.value = value) }),
    })
    mount(host, { attachTo: document.body, global: { plugins: [i18n] } })
    await flushPromises()
    expect(q('[data-test="status"]')?.textContent?.trim()).toBe('Connected')
  })
})
