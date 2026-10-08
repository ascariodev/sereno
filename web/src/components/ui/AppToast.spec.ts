import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AppToast from './AppToast.vue'
import { TOAST_LIMIT, toast, toasts } from './toast'

let wrapper: VueWrapper | undefined

beforeEach(() => {
  vi.useFakeTimers()
  wrapper = mount(AppToast, {
    props: { label: 'Notifications', closeLabel: 'Dismiss notification' },
    attachTo: document.body,
  })
})

afterEach(() => {
  toast.clear()
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  vi.useRealTimers()
})

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms)
  await flushPromises()
  await nextTick()
}

const items = () => Array.from(document.querySelectorAll<HTMLElement>('.app-toast'))

describe('toast store', () => {
  it('returns ids and uses a longer default duration for errors', () => {
    const a = toast.success('Saved')
    const b = toast.error('Failed')
    expect(b).toBeGreaterThan(a)
    expect(toasts.value.map((item) => item.duration)).toEqual([4000, 6000])
  })
})

describe('AppToast', () => {
  it('renders an empty named region', () => {
    const region = document.querySelector('[role=region]')
    expect(region?.getAttribute('aria-label')).toBe('Notifications')
    expect(items()).toHaveLength(0)
  })

  it('shows a success toast inside the region and announces it politely', async () => {
    toast.success('Group resolved')
    await settle(50)
    expect(items()).toHaveLength(1)
    const region = document.querySelector('[role=region]')!
    expect(region.contains(items()[0]!)).toBe(true)
    expect(items()[0]!.textContent).toContain('Group resolved')
    expect(items()[0]!.getAttribute('data-state')).toBe('open')
    const live = document.querySelector('[aria-live]')
    expect(live?.getAttribute('aria-live')).toBe('polite')
    expect(live?.textContent).toContain('Group resolved')
  })

  it('announces errors assertively', async () => {
    toast.error('Could not resolve')
    await settle(50)
    expect(items()[0]!.classList.contains('app-toast--error')).toBe(true)
    expect(document.querySelector('[aria-live]')?.getAttribute('aria-live')).toBe('assertive')
  })

  it('closes with the close button', async () => {
    toast.success('Group resolved')
    await settle(50)
    expect(items()).toHaveLength(1)
    document.querySelector<HTMLButtonElement>('button[name=close-toast]')!.click()
    await settle(400)
    expect(items()).toHaveLength(0)
    expect(toasts.value).toHaveLength(0)
  })

  it('closes by itself after its duration', async () => {
    toast.success('Reconnected', { duration: 1000 })
    await settle(50)
    expect(items()).toHaveLength(1)
    await settle(1100)
    await settle(400)
    expect(items()).toHaveLength(0)
  })

  it('keeps only the newest toasts up to the limit', async () => {
    for (let i = 1; i <= TOAST_LIMIT + 2; i++) toast.success(`Message ${i}`)
    await settle(50)
    expect(items()).toHaveLength(TOAST_LIMIT)
    expect(items().map((el) => el.textContent).join('|')).not.toContain('Message 1')
    expect(items()[TOAST_LIMIT - 1]!.textContent).toContain(`Message ${TOAST_LIMIT + 2}`)
  })

  it('labels the close button', async () => {
    toast.error('Failed')
    await settle(50)
    expect(document.querySelector('button[name=close-toast]')?.getAttribute('aria-label')).toBe('Dismiss notification')
  })
})
