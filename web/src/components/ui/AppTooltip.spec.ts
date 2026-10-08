import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { h, nextTick } from 'vue'
import AppTooltip from './AppTooltip.vue'

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

function mountTooltip() {
  wrapper = mount(AppTooltip, {
    props: { text: 'Resolve group' },
    slots: { default: () => h('button', { type: 'button', name: 'resolve' }, 'R') },
    attachTo: document.body,
  })
  return document.querySelector<HTMLButtonElement>('button[name=resolve]')!
}

async function settle() {
  await flushPromises()
  await nextTick()
}

describe('AppTooltip', () => {
  it('stays hidden until the trigger gets focus', () => {
    mountTooltip()
    expect(document.querySelector('[role=tooltip]')).toBeNull()
  })

  it('shows the text as role tooltip on focus and describes the trigger', async () => {
    const button = mountTooltip()
    button.focus()
    await settle()
    const tooltip = document.querySelector('[role=tooltip]')
    expect(tooltip?.textContent).toBe('Resolve group')
    expect(button.getAttribute('aria-describedby')).toBe(tooltip?.id)
  })

  it('Escape hides it and keeps the focus on the trigger', async () => {
    const button = mountTooltip()
    button.focus()
    await settle()
    expect(document.querySelector('[role=tooltip]')).not.toBeNull()
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(document.querySelector('[role=tooltip]')).toBeNull()
    expect(document.activeElement).toBe(button)
  })
})
