import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { i18n } from '../i18n'
import AppLayout from './AppLayout.vue'
import { createAppRouter } from '../router'
import { TOKEN_STORAGE_KEY, useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { THEME_STORAGE_KEY } from '../theme/theme'

const user = { id: 1, name: 'Ada', email: 'a@e.com', locale: 'en' }
const project = {
  id: 5,
  name: 'posveapi',
  key: 'POSVE',
  description: null,
  archived_at: null,
  created_at: '',
  updated_at: '',
}
const orgs = [
  { id: 1, name: 'One', slug: 'one', settings: null, roles: ['owner'] },
  { id: 2, name: 'Two', slug: 'two', settings: null, roles: ['member'] },
]

function sidebarData(path: string, withChannel = true): unknown {
  if (path === '/api/projects') return { data: [project], meta: { last_page: 1 } }
  if (path === '/api/channels') return withChannel ? { data: [{ id: 7, project_id: 5, name: 'general', project: { id: 5, name: 'posveapi' }, is_archived: false }] } : { data: [] }
  if (path === '/api/channels/7/messages') return { data: [], meta: { next_cursor: null } }
  return undefined
}

let mounted: VueWrapper | undefined

function key(target: Element, name: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
}

async function settle() {
  await flushPromises()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function openMenu(trigger: string) {
  const button = document.querySelector<HTMLButtonElement>(trigger)!
  button.focus()
  key(button, 'ArrowDown')
  await settle()
}

async function pick(value: string) {
  const item = document.querySelector<HTMLElement>(`[role^=menuitem][data-value="${value}"]`)!
  item.focus()
  key(item, 'Enter')
  await settle()
}

async function mountApp(
  organizations: () => Promise<unknown> = async () => ({ data: orgs }),
  path = '/',
  withChannel = true,
) {
  localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
  const pinia = createPinia()
  setActivePinia(pinia)
  vi.spyOn(api, 'get').mockImplementation(async (url: string) =>
    sidebarData(url, withChannel) ?? (url === '/api/me' ? { data: user } : ((await organizations()) as never)),
  )
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [pinia, i18n, router] }, attachTo: document.body })
  await flushPromises()
  mounted = wrapper
  return { wrapper, router }
}

describe('AppLayout', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    mounted?.unmount()
    mounted = undefined
    document.body.innerHTML = ''
  })

  it('shows the user, the organizations and the page', async () => {
    const { wrapper } = await mountApp()
    expect(wrapper.text()).toContain('Ada')
    expect(wrapper.find('button[name=organization]').text()).toBe('One')
    expect(wrapper.find('button[name=organization]').attributes('aria-label')).toBe('Organization: One')
    expect(wrapper.text()).toContain('Projects')
  })

  it('lists the organizations in the menu and choosing one changes the active organization', async () => {
    const { wrapper } = await mountApp()
    await openMenu('button[name=organization]')
    const options = [...document.querySelectorAll('[role^=menuitem]')]
    expect(options.map((el) => el.textContent?.trim())).toEqual(['One', 'Two'])
    await pick('2')
    expect(useOrganizationStore().activeId).toBe(2)
    expect(wrapper.find('button[name=organization]').text()).toBe('Two')
  })

  it('shows a message without organizations and no page', async () => {
    const { wrapper } = await mountApp(async () => ({ data: [] }))
    expect(wrapper.text()).toContain('You do not belong to any organization yet.')
    expect(wrapper.text()).not.toContain('Projects')
    expect(wrapper.find('button[name=organization]').exists()).toBe(false)
  })

  it('shows an error when loading fails', async () => {
    const { wrapper } = await mountApp(async () => {
      throw new ApiError(500, 'boom')
    })
    expect(wrapper.find('[role=alert]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Projects')
  })

  it('only the latest overlapping load turns the loading state off', async () => {
    const pending: Array<() => void> = []
    const { wrapper } = await mountApp(
      () => new Promise((resolve) => pending.push(() => resolve({ data: orgs }))),
    )
    expect(wrapper.find('.app-layout__main > p').text()).toBe('Loading...')
    const layout = wrapper.findComponent(AppLayout)
    void (layout.vm as unknown as { loadOrganizations: () => Promise<void> }).loadOrganizations()
    await flushPromises()
    expect(pending).toHaveLength(2)
    pending[0]()
    await flushPromises()
    expect(wrapper.find('.app-layout__main > p').text()).toBe('Loading...')
    pending[1]()
    await flushPromises()
    expect(wrapper.find('.app-layout__main > p').exists()).toBe(false)
    expect(wrapper.text()).toContain('Projects')
  })

  it('lists the projects and marks the active one with aria-current', async () => {
    const { wrapper } = await mountApp(undefined, '/channels/7')
    const link = wrapper.find('a[href="/channels/7"]')
    expect(link.text()).toContain('POSVE')
    expect(link.text()).toContain('posveapi')
    expect(link.attributes('aria-current')).toBe('page')
    expect(wrapper.find('a[href="/"]').attributes('aria-current')).toBeUndefined()
  })

  it('marks the project as current on its log page', async () => {
    const { wrapper } = await mountApp(undefined, '/projects/5/log')
    expect(wrapper.find('a[href="/channels/7"]').attributes('aria-current')).toBe('page')
    expect(wrapper.find('a[href="/"]').attributes('aria-current')).toBeUndefined()
  })

  it('marks Home as current on the home page', async () => {
    const { wrapper } = await mountApp()
    expect(wrapper.find('a[href="/"]').attributes('aria-current')).toBe('page')
    expect(wrapper.find('a[href="/channels/7"]').attributes('aria-current')).toBeUndefined()
  })

  it('logout clears the session and goes to login', async () => {
    const { router } = await mountApp()
    vi.spyOn(api, 'post').mockResolvedValue(undefined)
    await openMenu('button[name=user-menu]')
    expect(document.querySelector('[role=menu]')).not.toBeNull()
    await pick('logout')
    expect(router.currentRoute.value.name).toBe('login')
    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(useOrganizationStore().activeId).toBeNull()
  })

  it('the user menu changes and saves the theme', async () => {
    await mountApp()
    await openMenu('button[name=user-menu]')
    expect(document.querySelector('[role=menu]')).not.toBeNull()
    await pick('theme:dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    await openMenu('button[name=user-menu]')
    await pick('theme:system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
  })

  it('the search button in the sidebar opens the command palette', async () => {
    Element.prototype.scrollIntoView = () => {}
    await mountApp()
    expect(document.querySelector('[role=dialog]')).toBeNull()

    document.querySelector<HTMLButtonElement>('.app-layout__sidebar button[name=search]')!.click()
    await settle()

    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1)
    expect(document.activeElement?.getAttribute('role')).toBe('combobox')
    expect(document.querySelector('[role=option][data-value="log:5"]')).not.toBeNull()
  })

  it('the search button in the mobile top bar opens the command palette', async () => {
    Element.prototype.scrollIntoView = () => {}
    await mountApp()
    const button = document.querySelector<HTMLButtonElement>('.mobile-top-bar button[name=search]')!
    expect(button.getAttribute('aria-label')).toBe('Search')

    button.click()
    await settle()

    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1)
    expect(document.activeElement?.getAttribute('role')).toBe('combobox')
  })

  it('collapses the sidebar to icons, keeps accessible names and remembers the choice', async () => {
    const { wrapper } = await mountApp(undefined, '/channels/7')
    const sidebar = () => wrapper.find('.app-layout__sidebar')
    const toggle = () => sidebar().find('button[name=sidebar-toggle]')
    expect(toggle().attributes('aria-expanded')).toBe('true')
    expect(sidebar().text()).toContain('posveapi')
    expect(wrapper.find('.app-layout--collapsed').exists()).toBe(false)

    await toggle().trigger('click')
    expect(wrapper.find('.app-layout--collapsed').exists()).toBe(true)
    expect(toggle().attributes('aria-expanded')).toBe('false')
    expect(toggle().attributes('aria-label')).toBe('Expand sidebar')
    expect(sidebar().text()).not.toContain('posveapi')
    expect(sidebar().find('a[href="/channels/7"]').attributes('aria-label')).toBe('posveapi')
    expect(sidebar().find('a[href="/"]').attributes('aria-label')).toBe('Home')
    expect(sidebar().find('button[name=search]').attributes('aria-label')).toBe('Search')
    expect(localStorage.getItem('workspace.sidebar')).toBe('collapsed')

    await toggle().trigger('click')
    expect(sidebar().text()).toContain('posveapi')
    expect(localStorage.getItem('workspace.sidebar')).toBe('expanded')
  })

  it('names the project without a channel in the collapsed sidebar', async () => {
    localStorage.setItem('workspace.sidebar', 'collapsed')
    const { wrapper } = await mountApp(undefined, '/', false)
    const item = wrapper.find('.app-layout__sidebar span.app-sidebar__project--disabled')
    expect(item.attributes('aria-label')).toBe('posveapi')
    expect(item.attributes('aria-disabled')).toBe('true')
    expect(item.attributes('role')).toBe('link')
  })

  it('shows the project tooltip on focus only while the sidebar is collapsed', async () => {
    const { wrapper } = await mountApp(undefined, '/channels/7')
    const link = () => document.querySelector<HTMLAnchorElement>('.app-layout__sidebar a[href="/channels/7"]')!
    expect(wrapper.find('.app-layout--collapsed').exists()).toBe(false)
    link().focus()
    await settle()
    expect(document.querySelector('[role=tooltip]')).toBeNull()
    link().blur()

    await wrapper.find('.app-layout__sidebar button[name=sidebar-toggle]').trigger('click')
    link().focus()
    await settle()
    expect(document.querySelector('[role=tooltip]')?.textContent).toBe('posveapi')
  })

  it('starts collapsed when the choice was saved', async () => {
    localStorage.setItem('workspace.sidebar', 'collapsed')
    const { wrapper } = await mountApp()
    expect(wrapper.find('.app-layout--collapsed').exists()).toBe(true)
  })

  describe('mobile drawer', () => {
    const toggle = () => document.querySelector<HTMLButtonElement>('button[name=open-sidebar]')!
    const drawer = () => document.querySelector<HTMLElement>('[role=dialog]')

    async function openDrawer() {
      expect(drawer()).toBeNull()
      toggle().click()
      await settle()
      expect(drawer()).not.toBeNull()
    }

    it('has an accessible opener that reflects the drawer state', async () => {
      await mountApp()
      expect(toggle().getAttribute('aria-label')).toBe('Open navigation')
      expect(toggle().getAttribute('aria-expanded')).toBe('false')
      await openDrawer()
      expect(toggle().getAttribute('aria-expanded')).toBe('true')
      expect(drawer()!.classList.contains('app-dialog--sheet-left')).toBe(true)
      expect(drawer()!.querySelector('nav[aria-label="Main navigation"]')).not.toBeNull()
    })

    it('titles the drawer differently from the navigation landmark', async () => {
      await mountApp()
      await openDrawer()
      expect(drawer()!.getAttribute('aria-labelledby')).not.toBeNull()
      expect(drawer()!.textContent).toContain('Menu')
      expect(drawer()!.querySelector('nav')!.getAttribute('aria-label')).toBe('Main navigation')
    })

    it('stays open when following an external or new-tab link', async () => {
      await mountApp()
      await openDrawer()
      const nav = drawer()!.querySelector('nav')!
      const external = document.createElement('a')
      external.href = 'https://example.com/docs'
      external.addEventListener('click', (e) => e.preventDefault())
      const newTab = document.createElement('a')
      newTab.href = '/channels/7'
      newTab.target = '_blank'
      newTab.addEventListener('click', (e) => e.preventDefault())
      nav.append(external, newTab)
      external.click()
      newTab.click()
      await settle()
      expect(drawer()).not.toBeNull()
    })

    it('closes with Escape', async () => {
      await mountApp()
      await openDrawer()
      key(document.activeElement ?? document.body, 'Escape')
      await settle()
      expect(drawer()).toBeNull()
      expect(toggle().getAttribute('aria-expanded')).toBe('false')
    })

    it('closes when choosing a project', async () => {
      const { router } = await mountApp()
      await openDrawer()
      drawer()!.querySelector<HTMLAnchorElement>('a[href="/channels/7"]')!.click()
      await settle()
      expect(router.currentRoute.value.path).toBe('/channels/7')
      expect(drawer()).toBeNull()
    })

    it('closes when choosing Home while already there', async () => {
      const { router } = await mountApp()
      await openDrawer()
      drawer()!.querySelector<HTMLAnchorElement>('a[href="/"]')!.click()
      await settle()
      expect(router.currentRoute.value.path).toBe('/')
      expect(drawer()).toBeNull()
    })

    async function expectOnlyPaletteOpen() {
      expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1)
      expect(drawer()!.classList.contains('app-dialog--sheet-left')).toBe(false)
      expect(toggle().getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement?.getAttribute('role')).toBe('combobox')
    }

    it('the search button closes the drawer and opens the command palette', async () => {
      Element.prototype.scrollIntoView = () => {}
      await mountApp()
      await openDrawer()

      drawer()!.querySelector<HTMLButtonElement>('button[name=search]')!.click()
      await settle()
      await expectOnlyPaletteOpen()

      document.querySelector<HTMLElement>('[role=option][data-value="theme:dark"]')!.click()
      await settle()

      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
      expect(document.querySelector('[role=dialog]')).toBeNull()
    })

    it('Ctrl K closes the drawer and opens the command palette', async () => {
      Element.prototype.scrollIntoView = () => {}
      const { router } = await mountApp()
      await openDrawer()

      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
      await settle()
      await expectOnlyPaletteOpen()

      document.querySelector<HTMLElement>('[role=option][data-value="log:5"]')!.click()
      await settle()

      expect(router.currentRoute.value.path).toBe('/projects/5/log')
      expect(document.querySelector('[role=dialog]')).toBeNull()
    })

    it('closes when the viewport becomes wide and stops listening on unmount', async () => {
      let listener: ((event: { matches: boolean }) => void) | undefined
      const removeEventListener = vi.fn()
      window.matchMedia = vi.fn().mockReturnValue({
        addEventListener: (_: string, fn: typeof listener) => (listener = fn),
        removeEventListener,
      })
      try {
        await mountApp()
        await openDrawer()
        listener!({ matches: false })
        await settle()
        expect(drawer()).not.toBeNull()
        listener!({ matches: true })
        await settle()
        expect(drawer()).toBeNull()
        mounted?.unmount()
        mounted = undefined
        expect(removeEventListener).toHaveBeenCalledWith('change', listener)
      } finally {
        delete (window as { matchMedia?: unknown }).matchMedia
      }
    })
  })
})
