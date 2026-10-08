import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { i18n } from '../i18n'
import { createAppRouter } from '../router'
import { useAuthStore } from '../stores/auth'
import { saveThemePreference, THEME_STORAGE_KEY } from '../theme/theme'
import UserMenu from './UserMenu.vue'

let wrapper: VueWrapper | undefined

beforeEach(() => {
  localStorage.clear()
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

function checkedLabels(): string[] {
  return Array.from(document.querySelectorAll('[role=menuitemcheckbox][aria-checked=true]')).map((el) => el.textContent!.trim())
}

describe('UserMenu', () => {
  it('checks the stored theme when opened', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
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
})
