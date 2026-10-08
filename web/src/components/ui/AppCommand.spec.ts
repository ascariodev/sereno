import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AppCommand, { type AppCommandGroup } from './AppCommand.vue'

const groups: AppCommandGroup[] = [
  {
    label: 'Go to',
    items: [
      { value: 'channel:7', label: 'posveapi', hint: 'Channel', keywords: ['POSVE'] },
      { value: 'log:5', label: 'posveapi', hint: 'Log', keywords: ['POSVE'] },
      { value: 'log:6', label: 'Facturación', hint: 'Log' },
    ],
  },
  { label: 'Theme', items: [{ value: 'theme:dark', label: 'Dark theme' }] },
  { label: 'Empty', items: [] },
]

let wrapper: VueWrapper | undefined
let selected: string[] = []
let isOpen = true

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  selected = []
  isOpen = true
  document.body.innerHTML = ''
})

async function settle() {
  await flushPromises()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountOpen() {
  const instance: VueWrapper = mount(AppCommand, {
    props: {
      title: 'Command palette',
      placeholder: 'Search',
      emptyText: 'No results.',
      groups,
      open: true,
      'onUpdate:open': (value: boolean) => {
        isOpen = value
        void instance.setProps({ open: value })
      },
      onSelect: (value: string) => selected.push(value),
    },
    attachTo: document.body,
  })
  wrapper = instance
  await settle()
  return instance
}

function input(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('[role=combobox]')!
}

function options(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role=option]')]
}

function highlighted(): string | undefined {
  const id = input().getAttribute('aria-activedescendant')
  return id ? document.getElementById(id)?.dataset.value : undefined
}

function key(name: string) {
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
}

async function type(text: string) {
  input().value = text
  input().dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}

describe('AppCommand', () => {
  it('opens as a labelled dialog with the focus in the combobox and the first option highlighted', async () => {
    await mountOpen()

    const dialog = document.querySelector('[role=dialog]')!
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Command palette')
    expect(document.activeElement).toBe(input())
    expect(input().getAttribute('aria-controls')).toBe(document.querySelector('[role=listbox]')!.id)
    expect(options().map((option) => option.dataset.value)).toEqual(['channel:7', 'log:5', 'log:6', 'theme:dark'])
    expect(document.querySelectorAll('[role=group]')).toHaveLength(2)
    expect(document.querySelector('[role=status]')?.textContent).toBe('')
    expect(highlighted()).toBe('channel:7')
  })

  it('filters by every word in the label, hint and keywords, ignoring case and accents', async () => {
    await mountOpen()

    await type('posve LOG')
    expect(options().map((option) => option.dataset.value)).toEqual(['log:5'])
    expect(highlighted()).toBe('log:5')
    expect(document.querySelectorAll('[role=group]')).toHaveLength(1)

    await type('facturacion')
    expect(options().map((option) => option.dataset.value)).toEqual(['log:6'])
  })

  it('shows the empty text when nothing matches', async () => {
    await mountOpen()

    await type('nothing here')

    expect(options()).toHaveLength(0)
    expect(document.querySelector('[role=status]')?.textContent).toBe('No results.')
  })

  it('moves with the arrows and chooses with Enter, closing the dialog', async () => {
    await mountOpen()

    key('ArrowDown')
    await settle()
    expect(highlighted()).toBe('log:5')
    expect(document.activeElement).toBe(input())

    key('Enter')
    await settle()

    expect(selected).toEqual(['log:5'])
    expect(isOpen).toBe(false)
  })

  it('keeps the field expanded and the highlight when the pointer leaves the list', async () => {
    await mountOpen()
    expect(input().getAttribute('aria-expanded')).toBe('true')
    key('ArrowDown')
    await settle()
    expect(highlighted()).toBe('log:5')

    document.querySelector('.app-command')!.dispatchEvent(new Event('pointerleave'))
    await settle()

    expect(highlighted()).toBe('log:5')
    expect(input().getAttribute('aria-expanded')).toBe('true')
  })

  it('chooses an option with the pointer', async () => {
    await mountOpen()

    options()[3]!.click()
    await settle()

    expect(selected).toEqual(['theme:dark'])
  })

  it('closes with Escape without choosing', async () => {
    await mountOpen()
    expect(document.querySelector('[role=dialog]')).not.toBeNull()

    key('Escape')
    await settle()

    expect(isOpen).toBe(false)
    expect(selected).toEqual([])
  })

  it('clears the search when it opens again', async () => {
    const instance = await mountOpen()
    await type('posve')
    await instance.setProps({ open: false })
    await settle()

    await instance.setProps({ open: true })
    await settle()

    expect(input().value).toBe('')
    expect(options()).toHaveLength(4)
  })
})
