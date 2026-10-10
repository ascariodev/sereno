import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { openProjectCreateKey, useOpenProjectCreate } from './useProjectCreate'

function mountWith(provide?: Record<symbol, unknown>) {
  let open!: () => void
  const Comp = defineComponent({
    setup() {
      open = useOpenProjectCreate()
      return () => h('div')
    },
  })
  mount(Comp, { global: { provide } })
  return open
}

describe('useOpenProjectCreate', () => {
  afterEach(() => vi.restoreAllMocks())

  it('warns only when the fallback is invoked without a provider', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const open = mountWith()
    expect(warn).not.toHaveBeenCalled()
    open()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('uses the provided function without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provided = vi.fn()
    const open = mountWith({ [openProjectCreateKey as symbol]: provided })
    open()
    expect(provided).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
  })
})
