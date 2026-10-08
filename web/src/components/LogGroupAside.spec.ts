import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import { resetGroupStatuses, setGroupStatus, statusOfGroup } from '../composables/useLogGroupStatuses'
import { i18n } from '../i18n'
import { toast, toasts } from './ui/toast'
import LogGroupAside from './LogGroupAside.vue'

const loaded = {
  data: {
    id: 5,
    project_id: 3,
    level: 'error',
    title: 'Timeout in webhook',
    status: 'open',
    events_count: 3,
    first_seen_at: '2026-10-01T10:00:00.000000Z',
    last_seen_at: '2026-10-02T10:00:00.000000Z',
    events: [],
  },
}

let wrapper: VueWrapper | undefined
let listener: ((event: { matches: boolean }) => void) | undefined
const removeEventListener = vi.fn()

function fakeMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: (_: string, fn: typeof listener) => (listener = fn),
    removeEventListener,
  })
}

function mountAside() {
  wrapper = mount(LogGroupAside, {
    props: { projectId: 3, groupId: 5 },
    attrs: { class: 'wide-panel' },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  return wrapper
}

const sheet = () => document.querySelector('[role="dialog"]')

beforeEach(() => {
  resetGroupStatuses()
  vi.spyOn(api, 'get').mockResolvedValue(loaded as never)
  removeEventListener.mockClear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  listener = undefined
  delete (window as { matchMedia?: unknown }).matchMedia
  vi.restoreAllMocks()
})

describe('LogGroupAside', () => {
  it('reflects a status set elsewhere and writes its own actions to the shared map', async () => {
    mountAside()
    await flushPromises()
    expect(wrapper!.find('button[name=resolve]').exists()).toBe(true)
    setGroupStatus(5, 'resolved')
    await flushPromises()
    expect(wrapper!.find('button[name=resolve]').exists()).toBe(false)
    vi.spyOn(api, 'patch').mockResolvedValue({ data: { ...loaded.data, status: 'ignored' } } as never)
    await wrapper!.find('button[name=ignore]').trigger('click')
    await flushPromises()
    expect(statusOfGroup(5)).toBe('ignored')
    expect(wrapper!.emitted('status')).toEqual([['ignored']])
  })

  it('toasts and emits close with replace when the group is not found', async () => {
    fakeMatchMedia(false)
    toast.clear()
    mountAside()
    await flushPromises()
    expect(wrapper!.emitted('close')).toBeUndefined()
    vi.mocked(api.get).mockRejectedValue(new ApiError(404, 'Not found'))
    await wrapper!.setProps({ groupId: 6 })
    await flushPromises()
    expect(wrapper!.emitted('close')).toEqual([[true]])
    expect(toasts.value.map((item) => item.message)).toEqual(['This log group does not exist or you cannot access it.'])
  })

  it('emits close with replace when the group is not found on a narrow viewport', async () => {
    fakeMatchMedia(true)
    vi.mocked(api.get).mockRejectedValue(new ApiError(404, 'Not found'))
    mountAside()
    await flushPromises()
    expect(wrapper!.emitted('close')).toEqual([[true]])
  })

  it('renders an aside with the passed class when matchMedia is missing', async () => {
    mountAside()
    await flushPromises()
    expect(wrapper!.find('aside.wide-panel').exists()).toBe(true)
    expect(sheet()).toBeNull()
  })

  it('renders an aside on wide viewports and emits close from its button', async () => {
    fakeMatchMedia(false)
    mountAside()
    await flushPromises()
    expect(wrapper!.find('aside.wide-panel').exists()).toBe(true)
    expect(sheet()).toBeNull()
    await wrapper!.find('button[name=close-group]').trigger('click')
    expect(wrapper!.emitted('close')).toHaveLength(1)
  })

  it('renders a bottom sheet on narrow viewports with the panel loaded', async () => {
    fakeMatchMedia(true)
    mountAside()
    await flushPromises()
    expect(sheet()).not.toBeNull()
    expect(sheet()!.className).toContain('app-dialog--sheet-bottom')
    expect(sheet()!.querySelector('.log-group-panel h2')!.textContent).toBe('Timeout in webhook')
    expect(wrapper!.find('aside.wide-panel').exists()).toBe(false)
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1)
  })

  it('reloads the group when the refresh token changes', async () => {
    fakeMatchMedia(false)
    mountAside()
    await flushPromises()
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1)
    vi.mocked(api.get).mockResolvedValue({ data: { ...loaded.data, title: 'Renamed' } } as never)
    await wrapper!.setProps({ refreshToken: 1 })
    await flushPromises()
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2)
    expect(wrapper!.find('aside.wide-panel h2').text()).toBe('Renamed')
  })

  it('emits close from the panel button inside the sheet', async () => {
    fakeMatchMedia(true)
    mountAside()
    await flushPromises()
    sheet()!.querySelector<HTMLButtonElement>('button[name=close-group]')!.click()
    expect(wrapper!.emitted('close')).toHaveLength(1)
  })

  it('emits close on Escape', async () => {
    fakeMatchMedia(true)
    mountAside()
    await flushPromises()
    expect(sheet()).not.toBeNull()
    sheet()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper!.emitted('close')).toHaveLength(1)
  })

  it('emits close when clicking outside the sheet', async () => {
    fakeMatchMedia(true)
    mountAside()
    await flushPromises()
    expect(sheet()).not.toBeNull()
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper!.emitted('close')).toHaveLength(1)
  })

  it('switches between aside and sheet when the viewport changes and stops listening on unmount', async () => {
    fakeMatchMedia(false)
    mountAside()
    await flushPromises()
    expect(sheet()).toBeNull()
    listener!({ matches: true })
    await flushPromises()
    expect(sheet()).not.toBeNull()
    listener!({ matches: false })
    await flushPromises()
    expect(sheet()).toBeNull()
    expect(wrapper!.find('aside.wide-panel').exists()).toBe(true)
    wrapper!.unmount()
    wrapper = undefined
    expect(removeEventListener).toHaveBeenCalledWith('change', listener)
  })

  it('does not request the group again nor drop it when crossing the breakpoint', async () => {
    fakeMatchMedia(false)
    mountAside()
    await flushPromises()
    listener!({ matches: true })
    await flushPromises()
    expect(sheet()!.querySelector('.log-group-panel h2')!.textContent).toBe('Timeout in webhook')
    listener!({ matches: false })
    await flushPromises()
    expect(wrapper!.find('aside.wide-panel h2').text()).toBe('Timeout in webhook')
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1)
  })

  it('keeps the resolved status after crossing the breakpoint', async () => {
    fakeMatchMedia(false)
    vi.spyOn(api, 'patch').mockResolvedValue({ data: { ...loaded.data, status: 'resolved' } } as never)
    mountAside()
    await flushPromises()
    await wrapper!.find('button[name=resolve]').trigger('click')
    await flushPromises()
    listener!({ matches: true })
    await flushPromises()
    expect(sheet()!.querySelector('[data-status="resolved"]')).not.toBeNull()
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1)
  })

  it('moves focus to the aside on open and returns it to the opener on close', async () => {
    fakeMatchMedia(false)
    const card = document.createElement('button')
    document.body.appendChild(card)
    card.focus()
    expect(document.activeElement).toBe(card)
    mountAside()
    await flushPromises()
    const aside = wrapper!.find('aside.wide-panel').element
    expect(document.activeElement).toBe(aside)
    wrapper!.unmount()
    wrapper = undefined
    expect(document.activeElement).toBe(card)
  })

  it('does not steal focus from a text field when remounted', async () => {
    fakeMatchMedia(false)
    const field = document.createElement('textarea')
    document.body.appendChild(field)
    field.focus()
    mountAside()
    await flushPromises()
    expect(document.activeElement).toBe(field)
  })

  it('does not steal focus from a role=textbox field', async () => {
    fakeMatchMedia(false)
    const field = document.createElement('div')
    field.setAttribute('role', 'textbox')
    field.tabIndex = 0
    document.body.appendChild(field)
    field.focus()
    expect(document.activeElement).toBe(field)
    mountAside()
    await flushPromises()
    expect(document.activeElement).toBe(field)
  })

  it('keeps focus in the panel when the sheet becomes the aside', async () => {
    fakeMatchMedia(true)
    mountAside()
    await flushPromises()
    const close = sheet()!.querySelector<HTMLButtonElement>('button[name=close-group]')!
    close.focus()
    expect(document.activeElement).toBe(close)
    listener!({ matches: false })
    await flushPromises()
    expect(document.activeElement).toBe(wrapper!.find('aside.wide-panel').element)
  })

  it('does not move focus to the aside when it was outside the panel at the transition', async () => {
    fakeMatchMedia(true)
    mountAside()
    await flushPromises()
    ;(document.activeElement as HTMLElement).blur()
    expect(sheet()!.contains(document.activeElement)).toBe(false)
    listener!({ matches: false })
    await flushPromises()
    expect(wrapper!.find('aside.wide-panel').exists()).toBe(true)
    expect(document.activeElement).toBe(document.body)
  })

  it('does not steal focus back from the sheet on narrow viewports', async () => {
    fakeMatchMedia(true)
    const card = document.createElement('button')
    document.body.appendChild(card)
    card.focus()
    mountAside()
    await flushPromises()
    expect(sheet()!.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(card)
  })
})
