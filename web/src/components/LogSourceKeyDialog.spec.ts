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
  it('shows the key, the warning, the endpoint, the env block and the curl from config.apiUrl', async () => {
    mountHost()
    await flushPromises()
    expect(q('[data-test="warning"]')).not.toBeNull()
    expect(q('[data-test="key"]')?.textContent).toBe(issued.key)
    expect(q('[data-test="endpoint"]')?.textContent).toBe(`${config.apiUrl}/api/ingest/events`)
    expect(q('[data-test="env"]')?.textContent).toBe(`SERENO_LOG_URL=${config.apiUrl}\nSERENO_LOG_KEY=${issued.key}`)
    const curl = q('[data-test="curl"]')?.textContent ?? ''
    expect(curl).toContain(`${config.apiUrl}/api/ingest/events`)
    expect(curl).toContain(`Authorization: Bearer ${issued.key}`)
    expect(curl).toContain(' \\\n  -H "Authorization')
    expect(curl).not.toContain('\\n')
    expect(curl.split('\n')).toHaveLength(4)
  })

  it('copies the exact text of each block', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    vi.spyOn(toast, 'success').mockReturnValue(0)
    mountHost()
    await flushPromises()
    const buttons = [...document.body.querySelectorAll<HTMLButtonElement>('.copy-button')]
    expect(buttons).toHaveLength(4)
    for (const button of buttons) button.click()
    await flushPromises()
    expect(writeText.mock.calls.map((call) => call[0])).toEqual([
      issued.key,
      `${config.apiUrl}/api/ingest/events`,
      q('[data-test="env"]')?.textContent,
      q('[data-test="curl"]')?.textContent,
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
})
