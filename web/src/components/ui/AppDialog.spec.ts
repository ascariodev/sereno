import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { h, nextTick } from 'vue'
import AppDialog from './AppDialog.vue'
import AppMenu from './AppMenu.vue'

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

type Props = InstanceType<typeof AppDialog>['$props']

function body() {
  return [h('input', { name: 'first' }), h('button', { type: 'button', name: 'last' }, 'Last')]
}

function mountWithTrigger(props: Partial<Props> = {}) {
  wrapper = mount(AppDialog, {
    props: { title: 'Project settings', closeLabel: 'Close', ...props },
    slots: {
      trigger: () => h('button', { type: 'button', name: 'open-dialog' }, 'Open'),
      default: body,
    },
    attachTo: document.body,
  })
  return wrapper
}

function mountControlled(props: Partial<Props> = {}) {
  const outside = document.createElement('button')
  outside.name = 'outside'
  document.body.appendChild(outside)
  outside.focus()
  const instance: VueWrapper = mount(AppDialog, {
    props: {
      title: 'Search',
      open: true,
      'onUpdate:open': (value: boolean) => instance.setProps({ open: value }),
      ...props,
    },
    slots: { default: body },
    attachTo: document.body,
  })
  wrapper = instance
  return instance
}

function trigger(): HTMLButtonElement {
  return document.querySelector('button[name=open-dialog]')!
}

function dialog(): HTMLElement | null {
  return document.querySelector('[role=dialog]')
}

function key(target: Element, name: string, shiftKey = false) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }))
}

async function settle() {
  await flushPromises()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function openWithTrigger() {
  trigger().focus()
  trigger().click()
  await settle()
}

describe('AppDialog', () => {
  it('renders only the trigger while closed', () => {
    mountWithTrigger()
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(dialog()).toBeNull()
  })

  it('opens from the trigger, is labelled by its title and moves the focus inside', async () => {
    mountWithTrigger()
    await openWithTrigger()
    const el = dialog()!
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    const title = document.getElementById(el.getAttribute('aria-labelledby')!)
    expect(title?.textContent).toBe('Project settings')
    expect(title?.classList.contains('sr-only')).toBe(false)
    expect(el.contains(document.activeElement)).toBe(true)
    expect(el.classList.contains('app-dialog--center')).toBe(true)
  })

  it('traps the focus with Tab and Shift+Tab', async () => {
    mountWithTrigger()
    await openWithTrigger()
    const last = dialog()!.querySelector<HTMLButtonElement>('button[name=last]')!
    last.focus()
    key(last, 'Tab')
    await settle()
    expect(document.activeElement?.getAttribute('name')).toBe('close-dialog')
    key(document.activeElement!, 'Tab', true)
    await settle()
    expect(document.activeElement).toBe(last)
  })

  it('closes with Escape and returns the focus to the trigger', async () => {
    const dialogWrapper = mountWithTrigger()
    await openWithTrigger()
    expect(dialog()).not.toBeNull()
    key(document.activeElement!, 'Escape')
    await settle()
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(trigger())
    expect(dialogWrapper.emitted('update:open')).toEqual([[true], [false]])
  })

  it('closes with the close button', async () => {
    mountWithTrigger()
    await openWithTrigger()
    const close = document.querySelector<HTMLButtonElement>('button[name=close-dialog]')!
    expect(close.getAttribute('aria-label')).toBe('Close')
    close.click()
    await settle()
    expect(dialog()).toBeNull()
  })

  it('is controlled with v-model:open and returns the focus to the previous element', async () => {
    const dialogWrapper = mountControlled({ variant: 'sheet-bottom' })
    await settle()
    expect(dialog()!.classList.contains('app-dialog--sheet-bottom')).toBe(true)
    expect(document.querySelector('button[name=close-dialog]')).toBeNull()
    key(document.activeElement!, 'Escape')
    await settle()
    expect(dialog()).toBeNull()
    expect(document.activeElement?.getAttribute('name')).toBe('outside')
    await dialogWrapper.setProps({ open: true })
    await settle()
    expect(dialog()).not.toBeNull()
  })

  it('keeps a hidden title as the accessible name', async () => {
    mountControlled({ hideTitle: true, variant: 'sheet-right' })
    await settle()
    const title = document.getElementById(dialog()!.getAttribute('aria-labelledby')!)
    expect(title?.textContent).toBe('Search')
    expect(title?.classList.contains('sr-only')).toBe(true)
    expect(dialog()!.classList.contains('app-dialog--sheet-right')).toBe(true)
  })

  it('locks the body scroll while open and releases it on close', async () => {
    mountControlled()
    await settle()
    expect(dialog()).not.toBeNull()
    expect(document.body.style.overflow).toBe('hidden')
    key(document.activeElement!, 'Escape')
    await settle()
    expect(dialog()).toBeNull()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('keeps the dialog open when choosing from a menu inside it, and Escape closes the menu first', async () => {
    const selected: string[] = []
    wrapper = mount(AppDialog, {
      props: { title: 'Settings', open: true },
      slots: {
        default: () =>
          h(
            AppMenu,
            { items: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }], onSelect: (v: string) => selected.push(v) },
            () => h('button', { type: 'button', name: 'open-menu' }, 'Menu'),
          ),
      },
      attachTo: document.body,
    })
    await settle()
    const menuTrigger = () => document.querySelector<HTMLButtonElement>('button[name=open-menu]')!
    const menu = () => document.querySelector('[role=menu]')
    expect(dialog()).not.toBeNull()

    menuTrigger().focus()
    key(menuTrigger(), 'ArrowDown')
    await settle()
    expect(menu()).not.toBeNull()
    key(document.activeElement!, 'Escape')
    await settle()
    expect(menu()).toBeNull()
    expect(dialog()).not.toBeNull()

    menuTrigger().focus()
    key(menuTrigger(), 'ArrowDown')
    await settle()
    expect(menu()).not.toBeNull()
    key(document.activeElement!, 'Enter')
    await settle()
    expect(selected).toEqual(['one'])
    expect(menu()).toBeNull()
    expect(dialog()).not.toBeNull()
  })

  it('points aria-describedby to the description only when there is one', async () => {
    mountControlled({ description: 'Type to filter' })
    await settle()
    const description = document.getElementById(dialog()!.getAttribute('aria-describedby')!)
    expect(description?.textContent).toBe('Type to filter')
    wrapper!.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
    mountControlled()
    await settle()
    expect(dialog()!.hasAttribute('aria-describedby')).toBe(false)
  })
})
