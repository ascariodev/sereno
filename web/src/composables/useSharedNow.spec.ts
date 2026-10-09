import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { useSharedNow } from './useSharedNow'

const Probe = defineComponent({
  setup() {
    const now = useSharedNow()
    return { now }
  },
  template: '<span>{{ now }}</span>',
})

describe('useSharedNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())
  enableAutoUnmount(afterEach)

  it('shares one interval across subscribers and stops when the last unmounts', async () => {
    const a = mount(Probe)
    const b = mount(Probe)
    expect(vi.getTimerCount()).toBe(1)

    vi.advanceTimersByTime(60_000)
    await a.vm.$nextTick()
    expect(a.text()).toBe(String(Date.now()))
    expect(b.text()).toBe(String(Date.now()))

    a.unmount()
    expect(vi.getTimerCount()).toBe(1)
    b.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
