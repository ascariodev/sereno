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

  it('keeps the limit while the oldest toast is still leaving', async () => {
    for (let i = 1; i <= TOAST_LIMIT; i++) toast.success(`Message ${i}`)
    await settle(50)
    toast.success('Message extra')
    await settle(50)
    const open = toasts.value.filter((item) => item.open)
    expect(open).toHaveLength(TOAST_LIMIT)
    expect(open.map((item) => item.message)).toEqual(['Message 2', 'Message 3', 'Message extra'])
    expect(items().map((el) => el.textContent).join('|')).not.toContain('Message 1')
  })

  it('does not let a stale remove timer drop a toast after clear', async () => {
    const first = toast.success('First')
    await settle(50)
    // reka-ui keeps its own self-expiring timers (ToastRoot/Presence); only the delta from toast.ts is asserted
    const before = vi.getTimerCount()
    toast.dismiss(first)
    expect(vi.getTimerCount()).toBe(before + 1)
    toast.clear()
    expect(vi.getTimerCount()).toBe(before)
    toast.success('Second')
    await settle(50)
    expect(items()).toHaveLength(1)
    await settle(400)
    expect(toasts.value.map((item) => item.message)).toEqual(['Second'])
  })

  it('pauses the timer while the pointer is over the viewport and resumes on leave', async () => {
    toast.success('Hover me', { duration: 1000 })
    await settle(50)
    expect(items()).toHaveLength(1)
    const viewport = document.querySelector('.app-toast-viewport')!
    viewport.dispatchEvent(new Event('pointermove', { bubbles: true }))
    await settle(3000)
    expect(items()).toHaveLength(1)
    expect(toasts.value[0]!.open).toBe(true)
    viewport.dispatchEvent(new Event('pointerleave'))
    await settle(1100)
    await settle(400)
    expect(items()).toHaveLength(0)
  })

  it('runs the action and closes the toast when the action is selected', async () => {
    const onSelect = vi.fn()
    toast.info('A new version is available.', {
      duration: Number.POSITIVE_INFINITY,
      action: { label: 'Reload', onSelect },
    })
    await settle(50)
    expect(items()[0]!.classList.contains('app-toast--info')).toBe(true)
    const action = document.querySelector<HTMLButtonElement>('button[name=toast-action]')!
    expect(action.textContent?.trim()).toBe('Reload')
    action.click()
    await settle(400)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(items()).toHaveLength(0)
    expect(toasts.value).toHaveLength(0)
  })

  it('keeps a toast without a time limit open until it is dismissed', async () => {
    toast.info('A new version is available.', { duration: Number.POSITIVE_INFINITY })
    await settle(50)
    await settle(60 * 60 * 1000)
    expect(items()).toHaveLength(1)
    expect(toasts.value[0]!.open).toBe(true)
  })

  it('renders no action button without an action', async () => {
    toast.info('Heads up')
    await settle(50)
    expect(document.querySelector('button[name=toast-action]')).toBeNull()
  })

  it('labels the close button', async () => {
    toast.error('Failed')
    await settle(50)
    expect(document.querySelector('button[name=close-toast]')?.getAttribute('aria-label')).toBe('Dismiss notification')
  })
})
