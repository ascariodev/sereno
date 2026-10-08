import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { i18n, LOCALE_STORAGE_KEY, setLocale } from '../i18n'
import { toast, toasts } from './ui/toast'
import { createAppRouter } from '../router'
import { useAuthStore } from '../stores/auth'
import { initTheme, saveThemePreference, THEME_STORAGE_KEY } from '../theme/theme'
import UserMenu from './UserMenu.vue'

let wrapper: VueWrapper | undefined

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  toast.clear()
  setLocale('en')
  initTheme()
  setActivePinia(createPinia())
  useAuthStore().user = { id: 1, name: 'Ada', email: 'a@e.com', locale: 'en' }
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
})

async function settle() {
  await flushPromises()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function mountMenu() {
  wrapper = mount(UserMenu, {
    global: { plugins: [i18n, createAppRouter(createMemoryHistory())] },
    attachTo: document.body,
  })
}

function trigger(): HTMLButtonElement {
  return document.querySelector('button[name=user-menu]')!
}

async function open() {
  trigger().focus()
  trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  await settle()
  expect(document.querySelector('[role=menu]')).not.toBeNull()
}

const LANGUAGE_LABELS = ['Español', 'English']

function checkedLabels(): string[] {
  return Array.from(document.querySelectorAll('[role=menuitemcheckbox][aria-checked=true]'))
    .map((el) => el.textContent!.trim())
    .filter((label) => !LANGUAGE_LABELS.includes(label))
}

function item(label: string): HTMLElement {
  return Array.from(document.querySelectorAll('[role=menuitemcheckbox]')).find(
    (el) => el.textContent!.trim() === label,
  ) as HTMLElement
}

describe('UserMenu', () => {
  it('checks the stored theme when opened', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    initTheme()
    mountMenu()
    await open()
    expect(checkedLabels()).toEqual([i18n.global.t('userMenu.theme.dark')])
  })

  it('does not overwrite the session theme on mount', async () => {
    saveThemePreference('dark')
    localStorage.clear()
    mountMenu()
    await open()
    expect(checkedLabels()).toEqual([i18n.global.t('userMenu.theme.dark')])
  })

  it('checks the chosen theme and persists it', async () => {
    mountMenu()
    await open()
    expect(checkedLabels()).toEqual([i18n.global.t('userMenu.theme.system')])
    const light = Array.from(document.querySelectorAll('[role=menuitemcheckbox]')).find(
      (el) => el.textContent!.trim() === i18n.global.t('userMenu.theme.light'),
    ) as HTMLElement
    light.click()
    await settle()
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    await open()
    expect(checkedLabels()).toEqual([i18n.global.t('userMenu.theme.light')])
  })

  it('reflects a theme changed elsewhere (command palette)', async () => {
    mountMenu()
    saveThemePreference('dark')
    await open()
    expect(checkedLabels()).toEqual([i18n.global.t('userMenu.theme.dark')])
  })

  it('applies the chosen language and saves it in the API', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: { id: 1, name: 'Ada', email: 'a@e.com', locale: 'es' } })
    mountMenu()
    await open()
    item('Español').click()
    await settle()
    expect(patch).toHaveBeenCalledWith('/api/me/locale', { locale: 'es' })
    expect(i18n.global.locale.value).toBe('es')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es')
    expect(useAuthStore().user?.locale).toBe('es')
    expect(toasts.value).toHaveLength(0)
  })

  it('keeps the language applied and warns when saving fails', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(500, 'boom', {}))
    mountMenu()
    await open()
    item('Español').click()
    await settle()
    expect(i18n.global.locale.value).toBe('es')
    expect(useAuthStore().user?.locale).toBe('en')
    expect(toasts.value.map((t) => t.kind)).toEqual(['error'])
  })
})
