import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { i18n } from '../i18n'
import { useProjectsStore } from '../stores/projects'
import { THEME_STORAGE_KEY } from '../theme/theme'
import CommandPalette from './CommandPalette.vue'

const project = (id: number, name: string, key: string) => ({
  id,
  name,
  key,
  description: null,
  archived_at: null,
  created_at: '',
  updated_at: '',
})

let wrapper: VueWrapper | undefined

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

async function settle() {
  await flushPromises()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountPalette(): Promise<{ router: Router; open: () => boolean }> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const projects = useProjectsStore()
  projects.projects = [project(5, 'posveapi', 'POSVE'), project(6, 'billing', 'BILL')]
  projects.channelByProject = { 5: 7 }
  const stub = { template: '<div />' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'projects', component: stub },
      { path: '/channels/:id', name: 'channel', component: stub },
      { path: '/projects/:projectId/log', name: 'project-log', component: stub },
    ],
  })
  await router.push('/channels/7')
  await router.isReady()
  const isOpen = ref(false)
  const Host = defineComponent({
    components: { CommandPalette },
    setup: () => ({ isOpen }),
    template: '<CommandPalette v-model:open="isOpen" />',
  })
  wrapper = mount(Host, { global: { plugins: [pinia, i18n, router] }, attachTo: document.body })
  await settle()
  return { router, open: () => isOpen.value }
}

function shortcut(init: KeyboardEventInit = { key: 'k', ctrlKey: true }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  ;(document.activeElement ?? document.body).dispatchEvent(event)
  return event
}

function input(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('[role=combobox]')!
}

function optionValues(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[role=option]')].map((option) => option.dataset.value!)
}

async function type(text: string) {
  input().value = text
  input().dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}

async function choose(value: string) {
  document.querySelector<HTMLElement>(`[role=option][data-value="${value}"]`)!.click()
  await settle()
}

describe('CommandPalette', () => {
  it('Ctrl K opens it once and prevents the browser shortcut; again closes it', async () => {
    const { open } = await mountPalette()

    const event = shortcut()
    await settle()
    expect(event.defaultPrevented).toBe(true)
    expect(open()).toBe(true)
    expect(document.querySelector('[role=dialog]')).not.toBeNull()
    expect(document.activeElement).toBe(input())

    shortcut()
    await settle()
    expect(open()).toBe(false)
  })

  it('Meta K also opens it; other combinations and repeats do not', async () => {
    const { open } = await mountPalette()

    shortcut({ key: 'k', ctrlKey: true, shiftKey: true })
    shortcut({ key: 'k', ctrlKey: true, repeat: true })
    shortcut({ key: 'k' })
    await settle()
    expect(open()).toBe(false)

    shortcut({ key: 'K', metaKey: true })
    await settle()
    expect(open()).toBe(true)
  })

  it('stops listening after unmounting', async () => {
    const { open } = await mountPalette()
    wrapper!.unmount()
    wrapper = undefined

    const event = shortcut()
    await settle()

    expect(event.defaultPrevented).toBe(false)
    expect(open()).toBe(false)
  })

  it('lists Home, each project channel and log, and the themes', async () => {
    await mountPalette()
    shortcut()
    await settle()

    expect(optionValues()).toEqual(['home', 'channel:7', 'log:5', 'log:6', 'theme:system', 'theme:light', 'theme:dark'])
  })

  it('filters by project key and section', async () => {
    await mountPalette()
    shortcut()
    await settle()

    await type('bill log')
    expect(optionValues()).toEqual(['log:6'])

    await type('posve')
    expect(optionValues()).toEqual(['channel:7', 'log:5'])
  })

  it('goes to the log of a project and closes', async () => {
    const { router, open } = await mountPalette()
    shortcut()
    await settle()

    await choose('log:5')

    expect(router.currentRoute.value.fullPath).toBe('/projects/5/log')
    expect(open()).toBe(false)
  })

  it('goes to the channel of a project and to Home', async () => {
    const { router } = await mountPalette()
    await router.push('/')
    shortcut()
    await settle()
    await choose('channel:7')
    expect(router.currentRoute.value.fullPath).toBe('/channels/7')

    shortcut()
    await settle()
    await choose('home')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('changes and saves the theme', async () => {
    await mountPalette()
    shortcut()
    await settle()

    await choose('theme:dark')

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })
})
