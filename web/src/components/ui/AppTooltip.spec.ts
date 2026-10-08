import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from 'reka-ui'
import { defineComponent, h, nextTick } from 'vue'
import AppTooltip from './AppTooltip.vue'
import { TOOLTIP_SKIP_DELAY_MS } from './tooltipDelay'

const PROVIDER_DELAY_MS = 1000

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

  it('inherits the provider delay: closed before 1000 ms, open after', async () => {
    vi.useFakeTimers()
    try {
      const Host = defineComponent({
        render: () =>
          h(TooltipProvider, { delayDuration: PROVIDER_DELAY_MS, skipDelayDuration: TOOLTIP_SKIP_DELAY_MS }, () =>
            h(AppTooltip, { text: 'Resolve group' }, () => h('button', { type: 'button', name: 'resolve' }, 'R')),
          ),
      })
      wrapper = mount(Host, { attachTo: document.body })
      const button = document.querySelector<HTMLButtonElement>('button[name=resolve]')!
      button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }))
      await vi.advanceTimersByTimeAsync(PROVIDER_DELAY_MS - 1)
      await settle()
      expect(document.querySelector('[role=tooltip]')).toBeNull()
      await vi.advanceTimersByTimeAsync(1)
      await settle()
      expect(document.querySelector('[role=tooltip]')?.textContent).toBe('Resolve group')
    } finally {
      vi.useRealTimers()
    }
  })

  it('creates its own provider only when there is none', () => {
    mountTooltip()
    expect(wrapper!.findAllComponents(TooltipProvider)).toHaveLength(1)
    wrapper!.unmount()

    const Host = defineComponent({
      render: () =>
        h(TooltipProvider, null, () =>
          h(AppTooltip, { text: 'Resolve group' }, () => h('button', { type: 'button', name: 'resolve' }, 'R')),
        ),
    })
    wrapper = mount(Host, { attachTo: document.body })
    expect(wrapper.findAllComponents(TooltipProvider)).toHaveLength(1)
  })
})
