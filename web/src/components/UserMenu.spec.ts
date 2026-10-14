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
import { useOrganizationStore } from '../stores/organization'
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

function mountMenu(router = createAppRouter(createMemoryHistory())) {
  wrapper = mount(UserMenu, {
    global: { plugins: [i18n, router] },
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

async function openSubmenu(value: 'theme' | 'language') {
  document.querySelector<HTMLElement>(`[role=menuitem][data-value=${value}]`)!.click()
  await settle()
  expect(document.querySelectorAll('[role=menu]')).toHaveLength(2)
}

async function openTheme() {
  await open()
  await openSubmenu('theme')
}

function checkedLabels(): string[] {
  return Array.from(document.querySelectorAll('[role=menuitemcheckbox][aria-checked=true]')).map((el) =>
    el.textContent!.trim(),
  )
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
    await openTheme()
    expect(checkedLabels()).toEqual([i18n.global.t('userMenu.themeOption.dark')])
  })

  it('does not overwrite the session theme on mount', async () => {
    saveThemePreference('dark')
    localStorage.clear()
    mountMenu()
    await openTheme()
    expect(checkedLabels()).toEqual([i18n.global.t('userMenu.themeOption.dark')])
  })

  it('checks the chosen theme and persists it', async () => {
    mountMenu()
    await openTheme()
    expect(checkedLabels()).toEqual([i18n.global.t('userMenu.themeOption.system')])
    item(i18n.global.t('userMenu.themeOption.light')).click()
    await settle()
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    await openTheme()
    expect(checkedLabels()).toEqual([i18n.global.t('userMenu.themeOption.light')])
  })

  it('reflects a theme changed elsewhere (command palette)', async () => {
    mountMenu()
    saveThemePreference('dark')
    await openTheme()
    expect(checkedLabels()).toEqual([i18n.global.t('userMenu.themeOption.dark')])
  })

  it('applies the chosen language and saves it in the API', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: { id: 1, name: 'Ada', email: 'a@e.com', locale: 'es' } })
    mountMenu()
    await open()
    await openSubmenu('language')
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
    await openSubmenu('language')
    item('Español').click()
    await settle()
    expect(i18n.global.locale.value).toBe('es')
    expect(useAuthStore().user?.locale).toBe('en')
    expect(toasts.value.map((t) => t.kind)).toEqual(['error'])
  })

  describe('notification preferences entry', () => {
    const ALL = { task_assigned: true, task_comment_mention: true, task_commented: false, chat_mention: true }
    const PREFERENCES = { data: { email: ALL, push: ALL } }

    function entry(): HTMLElement | undefined {
      return Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(
        (el) => el.textContent!.trim() === 'Notifications',
      )
    }

    it('opens the dialog, loads the preferences and returns focus to the trigger on close', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValue(PREFERENCES)
      const push = vi.spyOn(createAppRouter(createMemoryHistory()), 'push')
      mountMenu()
      await open()
      entry()!.click()
      await settle()
      expect(push).not.toHaveBeenCalled()
      expect(get).toHaveBeenCalledWith('/api/me/notification-preferences')
      expect(document.querySelectorAll('input[role=switch]')).toHaveLength(8)
      document.querySelector<HTMLButtonElement>('button[name=close-dialog]')!.click()
      await settle()
      expect(document.querySelector('input[role=switch]')).toBeNull()
      expect(document.activeElement).toBe(trigger())
    })

    it('does not load the preferences until the entry is chosen', async () => {
      const get = vi.spyOn(api, 'get').mockResolvedValue(PREFERENCES)
      mountMenu()
      await open()
      expect(get).not.toHaveBeenCalled()
    })
  })

  describe('members entry', () => {
    function membersEntry(): HTMLElement | undefined {
      return Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(
        (el) => el.textContent!.trim() === 'Members',
      )
    }

    it.each([['owner'], ['admin'], ['member']])('shows the entry to %s and navigates to the screen', async (role) => {
      useOrganizationStore().$patch({
        organizations: [{ id: 1, name: 'Acme', slug: 'acme', settings: null, roles: [role] }],
        activeId: 1,
      })
      const router = createAppRouter(createMemoryHistory())
      const push = vi.spyOn(router, 'push')
      mountMenu(router)
      await open()
      expect(membersEntry()).toBeDefined()
      membersEntry()!.click()
      await settle()
      expect(push).toHaveBeenCalledWith({ name: 'members' })
    })
  })

  describe('invitations entry', () => {
    function entry(): HTMLElement | undefined {
      return Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(
        (el) => el.textContent!.trim() === 'Invitations',
      )
    }

    function withRoles(roles: string[] | null) {
      const organization = useOrganizationStore()
      if (roles) {
        organization.$patch({
          organizations: [{ id: 1, name: 'Acme', slug: 'acme', settings: null, roles }],
          activeId: 1,
        })
      }
    }

    it.each([['owner'], ['admin']])('shows the entry to %s and navigates to the screen', async (role) => {
      withRoles([role])
      const router = createAppRouter(createMemoryHistory())
      const push = vi.spyOn(router, 'push')
      mountMenu(router)
      await open()
      expect(entry()).toBeDefined()
      entry()!.click()
      await settle()
      expect(push).toHaveBeenCalledWith({ name: 'invitations' })
    })

    it('hides the entry from members', async () => {
      withRoles(['member'])
      mountMenu()
      await open()
      expect(entry()).toBeUndefined()
    })

    it('hides the entry while no organization is active', async () => {
      withRoles(null)
      mountMenu()
      await open()
      expect(entry()).toBeUndefined()
    })
  })
})
