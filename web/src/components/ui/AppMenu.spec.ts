import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { h, nextTick } from 'vue'
import AppMenu, { type AppMenuItem } from './AppMenu.vue'

const items: AppMenuItem[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'archived', label: 'Archived', disabled: true },
  { value: 'settings', label: 'Settings' },
  { value: 'logout', label: 'Log out', danger: true },
]

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

function mountMenu() {
  wrapper = mount(AppMenu, {
    props: { items },
    slots: { default: () => h('button', { type: 'button', name: 'open-menu' }, 'Menu') },
    attachTo: document.body,
  })
  return wrapper
}

function trigger(): HTMLButtonElement {
  return document.querySelector('button[name=open-menu]')!
}

function menu(): HTMLElement | null {
  return document.querySelector('[role=menu]')
}

function key(target: Element, name: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
}

async function settle() {
  await flushPromises()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function openWithKeyboard() {
  trigger().focus()
  key(trigger(), 'ArrowDown')
  await settle()
}

describe('AppMenu', () => {
  it('renders only the trigger while closed', () => {
    mountMenu()
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(menu()).toBeNull()
  })

  it('opens from the keyboard with the items as menuitems and focuses the first one', async () => {
    mountMenu()
    await openWithKeyboard()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    const options = [...menu()!.querySelectorAll('[role=menuitem]')]
    expect(options.map((el) => el.textContent?.trim())).toEqual(['Profile', 'Archived', 'Settings', 'Log out'])
    expect(options[1].getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement?.textContent?.trim()).toBe('Profile')
  })

  it('arrows move the focus skipping disabled items and Enter selects', async () => {
    const menuWrapper = mountMenu()
    await openWithKeyboard()
    key(document.activeElement!, 'ArrowDown')
    await settle()
    expect(document.activeElement?.textContent?.trim()).toBe('Settings')
    key(document.activeElement!, 'ArrowUp')
    await settle()
    expect(document.activeElement?.textContent?.trim()).toBe('Profile')
    key(document.activeElement!, 'ArrowDown')
    await settle()
    key(document.activeElement!, 'Enter')
    await settle()
    expect(menuWrapper.emitted('select')).toEqual([['settings']])
    expect(menu()).toBeNull()
  })

  it('Escape closes without selecting and returns the focus to the trigger', async () => {
    const menuWrapper = mountMenu()
    await openWithKeyboard()
    expect(menu()).not.toBeNull()
    expect(document.activeElement).not.toBe(trigger())
    key(document.activeElement!, 'Escape')
    await settle()
    expect(menu()).toBeNull()
    expect(menuWrapper.emitted('select')).toBeUndefined()
    expect(document.activeElement).toBe(trigger())
  })
})
