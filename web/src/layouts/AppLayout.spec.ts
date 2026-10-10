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
import { useMentionsStore } from '../stores/mentions'
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

let projectExtra: Record<string, unknown> = {}
let mentionsUnread = 0

function sidebarData(path: string, withChannel = true): unknown {
  if (path === '/api/projects') return { data: [{ ...project, ...projectExtra }], meta: { last_page: 1 } }
  if (path === '/api/channels') return withChannel ? { data: [{ id: 7, project_id: 5, name: 'general', project: { id: 5, name: 'posveapi' }, is_archived: false }] } : { data: [] }
  if (path === '/api/mentions') return { data: [], links: {}, meta: { next_cursor: null, unread_count: mentionsUnread } }
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
    projectExtra = {}
    mentionsUnread = 0
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
    expect(options.map((el) => el.textContent?.trim())).toEqual(['One', 'Two', 'New organization'])
    await pick('2')
    expect(useOrganizationStore().activeId).toBe(2)
    expect(wrapper.find('button[name=organization]').text()).toBe('Two')
  })

  it('shows a message without organizations and no page', async () => {
    const { wrapper } = await mountApp(async () => ({ data: [] }))
    expect(wrapper.text()).toContain('You do not belong to any organization yet.')
    expect(wrapper.find('.app-layout__empty').text()).toContain('ask an owner or admin')
    expect(wrapper.text()).not.toContain('Projects')
    expect(wrapper.find('button[name=organization]').exists()).toBe(false)
  })

  async function createOrganizationThroughDialog(name: string) {
    const input = document.querySelector<HTMLInputElement>('#org-create-name')!
    input.value = name
    input.dispatchEvent(new Event('input'))
    await settle()
    document.querySelector<HTMLFormElement>('[role=dialog] form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await settle()
  }

  it('creates an organization from the empty state and then renders the projects view', async () => {
    let current: unknown[] = []
    const created = { id: 9, name: 'Acme', slug: 'acme', settings: null, roles: ['owner'] }
    const { wrapper } = await mountApp(async () => ({ data: current }))
    vi.spyOn(api, 'post').mockImplementation(async () => {
      current = [created]
      return { data: created } as never
    })
    wrapper.find<HTMLButtonElement>('button[name=create-organization]').element.click()
    await settle()
    expect(document.querySelector('[role=dialog]')).not.toBeNull()

    await createOrganizationThroughDialog('Acme')

    expect(useOrganizationStore().activeId).toBe(9)
    expect(wrapper.find('.app-layout__empty').exists()).toBe(false)
    expect(wrapper.text()).toContain('Projects')
    expect(document.querySelector('[role=dialog]')).toBeNull()
  })

  it('opens the create dialog from the organization menu', async () => {
    await mountApp()
    await openMenu('button[name=organization]')
    await pick('create')
    expect(document.querySelector('[role=dialog] #org-create-name')).not.toBeNull()
    expect(useOrganizationStore().activeId).toBe(1)
  })

  it('opening the create dialog from the drawer closes the drawer', async () => {
    await mountApp()
    document.querySelector<HTMLButtonElement>('button[name=open-sidebar]')!.click()
    await settle()
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1)
    await openMenu('[role=dialog] button[name=organization]')
    await pick('create')
    const dialogs = [...document.querySelectorAll('[role=dialog]')]
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0].querySelector('#org-create-name')).not.toBeNull()
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

  describe('open log groups', () => {
    it('shows the count and the highest level next to the project', async () => {
      projectExtra = { open_groups_count: 3, open_max_level: 'error' }
      const { wrapper } = await mountApp(undefined, '/')
      const link = wrapper.find('a[href="/channels/7"]')
      const badge = link.find('.app-sidebar__open')
      expect(badge.text()).toBe('3')
      expect(badge.classes()).toContain('app-sidebar__open--error')
      expect(link.attributes('aria-label')).toBe('posveapi: 3 open log groups, highest level error')
    })

    it('uses the singular for one open group', async () => {
      projectExtra = { open_groups_count: 1, open_max_level: 'warning' }
      const { wrapper } = await mountApp(undefined, '/')
      expect(wrapper.find('a[href="/channels/7"]').attributes('aria-label')).toBe(
        'posveapi: 1 open log group, highest level warning',
      )
    })

    it('shows nothing without open groups', async () => {
      projectExtra = { open_groups_count: 0, open_max_level: null }
      const { wrapper } = await mountApp(undefined, '/')
      const link = wrapper.find('a[href="/channels/7"]')
      expect(link.find('.app-sidebar__open').exists()).toBe(false)
      expect(link.attributes('aria-label')).toBeUndefined()
    })

    it('shows nothing when the fields are missing', async () => {
      const { wrapper } = await mountApp(undefined, '/')
      expect(wrapper.find('.app-sidebar__open').exists()).toBe(false)
      expect(wrapper.find('a[href="/channels/7"]').attributes('aria-label')).toBeUndefined()
    })

    it('keeps the indicator and an accessible name when collapsed', async () => {
      localStorage.setItem('workspace.sidebar', 'collapsed')
      projectExtra = { open_groups_count: 2, open_max_level: 'critical' }
      const { wrapper } = await mountApp(undefined, '/')
      expect(wrapper.find('.app-layout--collapsed').exists()).toBe(true)
      const link = wrapper.find('.app-layout__sidebar a[href="/channels/7"]')
      expect(link.find('.app-sidebar__open').text()).toBe('2')
      expect(link.attributes('aria-label')).toBe('posveapi: 2 open log groups, highest level critical')
    })

    it('names the open groups in the project without a channel', async () => {
      projectExtra = { open_groups_count: 2, open_max_level: 'info' }
      const { wrapper } = await mountApp(undefined, '/', false)
      const item = wrapper.find('.app-layout__sidebar span.app-sidebar__project--disabled')
      expect(item.find('.app-sidebar__open').text()).toBe('2')
      expect(item.attributes('aria-label')).toBe('posveapi: 2 open log groups, highest level info')
    })

    it('translates the label to Spanish', async () => {
      projectExtra = { open_groups_count: 2, open_max_level: 'error' }
      try {
        const { wrapper } = await mountApp(undefined, '/')
        i18n.global.locale.value = 'es'
        await nextTick()
        expect(wrapper.find('a[href="/channels/7"]').attributes('aria-label')).toBe(
          'posveapi: 2 grupos de logs abiertos, nivel máximo error',
        )
      } finally {
        i18n.global.locale.value = 'en'
      }
    })
  })

  it('marks the project as current on its log page', async () => {
    const { wrapper } = await mountApp(undefined, '/projects/5/log')
    expect(wrapper.find('a[href="/channels/7"]').attributes('aria-current')).toBe('page')
    expect(wrapper.find('a[href="/"]').attributes('aria-current')).toBeUndefined()
  })

  it('marks the project as current on its plan page', async () => {
    const { wrapper } = await mountApp(undefined, '/projects/5/plan')
    expect(wrapper.find('a[href="/channels/7"]').attributes('aria-current')).toBe('page')
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

  it('shows the unread mentions count with a text for screen readers, and hides it at zero', async () => {
    mentionsUnread = 3
    const { wrapper } = await mountApp()
    const link = wrapper.find('a[href="/mentions"]')
    expect(link.exists()).toBe(true)
    expect(link.find('.app-sidebar__badge').text()).toBe('3')
    expect(link.find('.app-sidebar__badge').attributes('aria-hidden')).toBe('true')
    expect(link.find('.sr-only').text()).toBe('3 unread mentions')
    useMentionsStore().$patch({ unreadCount: 0 })
    await nextTick()
    expect(wrapper.find('a[href="/mentions"] .app-sidebar__badge').exists()).toBe(false)
    expect(wrapper.find('a[href="/mentions"] .sr-only').exists()).toBe(false)
  })

  it('names the mentions link with the count when the sidebar is collapsed', async () => {
    localStorage.setItem('workspace.sidebar', 'collapsed')
    mentionsUnread = 1
    const { wrapper } = await mountApp()
    expect(wrapper.find('a[href="/mentions"]').attributes('aria-label')).toBe('Mentions: 1 unread mention')
  })

  it('starts the mentions store for the signed-in user and stops it on logout', async () => {
    mentionsUnread = 2
    await mountApp()
    const store = useMentionsStore()
    expect(store.unreadCount).toBe(2)
    expect(store.loaded).toBe(true)
    vi.spyOn(api, 'post').mockResolvedValue(undefined)
    await openMenu('button[name=user-menu]')
    await pick('logout')
    expect(store.unreadCount).toBe(0)
    expect(store.loaded).toBe(false)
  })

  it('stops the mentions store when the layout unmounts', async () => {
    mentionsUnread = 2
    const { wrapper } = await mountApp()
    expect(useMentionsStore().unreadCount).toBe(2)
    wrapper.unmount()
    mounted = undefined
    expect(useMentionsStore().unreadCount).toBe(0)
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
    expect(item.attributes('tabindex')).toBeUndefined()
  })

  it('keeps the project without a channel out of the tab order and as a link when expanded', async () => {
    const { wrapper } = await mountApp(undefined, '/', false)
    expect(wrapper.find('.app-layout--collapsed').exists()).toBe(false)
    const item = wrapper.find('.app-layout__sidebar span.app-sidebar__project--disabled')
    expect(item.text()).toContain('posveapi')
    expect(item.attributes('role')).toBe('link')
    expect(item.attributes('aria-disabled')).toBe('true')
    expect(item.attributes('tabindex')).toBeUndefined()
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
