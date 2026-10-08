import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AppSegmented, { type AppSegmentedOption } from './AppSegmented.vue'

const options: AppSegmentedOption[] = [
  { value: 'open', label: 'Open', count: 4 },
  { value: 'resolved', label: 'Resolved' },
  { value: 'ignored', label: 'Ignored', disabled: true },
  { value: 'all', label: 'All' },
]

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

function mountSegmented(modelValue = 'open') {
  wrapper = mount(AppSegmented, { props: { modelValue, options, label: 'Status' }, attachTo: document.body })
  return wrapper
}

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role=group] button')]
}

function key(target: Element, name: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
}

async function settle() {
  await flushPromises()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('AppSegmented', () => {
  it('renders a named group with aria-pressed reflecting the value and the count', () => {
    mountSegmented()
    const group = document.querySelector('[role=group]')!
    expect(group.getAttribute('aria-label')).toBe('Status')
    expect(buttons().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])
    expect(buttons()[0].textContent?.replace(/\s+/g, ' ').trim()).toBe('Open, 4')
    expect(buttons()[0].textContent).toContain('Open')
    expect(buttons()[0].querySelector('.app-segmented__sep')?.textContent).toBe(', ')
    expect(buttons()[2].disabled).toBe(true)
  })

  it('renders aria-label and lang only on options that define them', () => {
    wrapper = mount(AppSegmented, {
      props: {
        modelValue: 'es',
        label: 'Language',
        options: [
          { value: 'es', label: 'ES', ariaLabel: 'Español', lang: 'es' },
          { value: 'plain', label: 'Plain' },
        ],
      },
      attachTo: document.body,
    })
    const [named, plain] = buttons()
    expect(named.getAttribute('aria-label')).toBe('Español')
    expect(named.getAttribute('lang')).toBe('es')
    expect(plain.hasAttribute('aria-label')).toBe(false)
    expect(plain.hasAttribute('lang')).toBe(false)
  })

  it('clicking another option emits update:modelValue', async () => {
    const segmented = mountSegmented()
    buttons()[1].click()
    await settle()
    expect(segmented.emitted('update:modelValue')).toEqual([['resolved']])
  })

  it('clicking the pressed option does not leave the group empty', async () => {
    const segmented = mountSegmented()
    expect(buttons()[0].getAttribute('aria-pressed')).toBe('true')
    buttons()[0].click()
    await settle()
    expect(segmented.emitted('update:modelValue')).toBeUndefined()
    expect(buttons()[0].getAttribute('aria-pressed')).toBe('true')
  })

  it('arrows move the focus skipping disabled options and wrap, a click selects', async () => {
    const segmented = mountSegmented()
    await settle()
    await settle()
    buttons()[0].focus()
    key(document.activeElement!, 'ArrowRight')
    await settle()
    expect(document.activeElement).toBe(buttons()[1])
    key(document.activeElement!, 'ArrowRight')
    await settle()
    expect(document.activeElement).toBe(buttons()[3])
    key(document.activeElement!, 'ArrowRight')
    await settle()
    expect(document.activeElement).toBe(buttons()[0])
    key(document.activeElement!, 'ArrowLeft')
    await settle()
    expect(document.activeElement).toBe(buttons()[3])
    buttons()[3].click()
    await settle()
    expect(segmented.emitted('update:modelValue')).toEqual([['all']])
  })

  it('follows the new value from the parent', async () => {
    const segmented = mountSegmented()
    await segmented.setProps({ modelValue: 'all' })
    expect(buttons().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true'])
  })
})
