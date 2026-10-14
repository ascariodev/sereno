import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesApi from '../api/messages'
import { ApiError } from '../api/client'
import { i18n } from '../i18n'
import type { MessageAttachment } from '../api/types'
import MessageAttachments from './MessageAttachments.vue'
import { toast, toasts } from './ui/toast'
import { installExternalLinks } from '../platform/desktop'

const openUrl = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }))

const image: MessageAttachment = {
  id: 1, original_name: 'foto.png', mime: 'image/png', size: 2048, created_at: '2026-03-04T10:30:00Z', url: 'http://api/attachments/1?sig=a',
}
const pdf: MessageAttachment = {
  id: 2, original_name: 'informe.pdf', mime: 'application/pdf', size: 3 * 1024 * 1024, created_at: '2026-03-04T10:30:00Z', url: 'http://api/attachments/2?sig=b',
}

function render(attachments: MessageAttachment[]) {
  return mount(MessageAttachments, { props: { attachments }, global: { plugins: [i18n] } })
}

let renew: ReturnType<typeof vi.spyOn>

describe('MessageAttachments', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    toast.clear()
  })

  beforeEach(() => {
    i18n.global.locale.value = 'en'
    renew = vi.spyOn(messagesApi, 'getAttachmentUrl').mockRejectedValue(new ApiError(404, 'gone'))
  })

  it('renders nothing without attachments', () => {
    const w = render([])
    expect(w.find('ul').exists()).toBe(false)
    expect(w.find('[role="status"]').exists()).toBe(false)
    expect(w.find('.message-attachments-wrap').exists()).toBe(false)
  })

  it('keeps one empty status region mounted until a preview fails', async () => {
    const w = render([image, { ...image, id: 3, url: 'http://api/attachments/3?sig=c' }])
    expect(w.get('[role="status"]').text()).toBe('')
    await w.findAll('img')[0].trigger('error')
    await flushPromises()
    await w.get('img').trigger('error')
    await flushPromises()
    expect(w.findAll('[role="status"]')).toHaveLength(1)
    expect(w.get('[role="status"]').text()).toBe('The preview is no longer available.')
  })

  it('shows a lazy thumbnail linking to the image', () => {
    const w = render([image])
    const img = w.get('img')
    expect(img.attributes('alt')).toBe('foto.png')
    expect(img.attributes('loading')).toBe('lazy')
    expect(img.attributes('src')).toBe(image.url)
    const a = w.get('a')
    expect(a.attributes('href')).toBe(image.url)
    expect(a.attributes('rel')).toContain('noopener')
    expect(w.text()).not.toContain('Download')
  })

  it('shows a file row with name, size and a named download link', () => {
    const w = render([pdf])
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toContain('informe.pdf')
    expect(w.text()).toContain('3 MB')
    const a = w.get('a')
    expect(a.attributes('href')).toBe(pdf.url)
    expect(a.attributes('rel')).toContain('noopener')
    expect(a.attributes('aria-label')).toBe('Download: informe.pdf')
    expect(a.attributes('download')).toBeUndefined()
  })

  it('does not preview non-inline image types', () => {
    const w = render([{ ...image, mime: 'image/svg+xml' }])
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).not.toContain('no longer available')
  })

  it('falls back to the notice and file row when renewing the url fails', async () => {
    const w = render([image, pdf])
    await w.get('img').trigger('error')
    await flushPromises()
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toContain('The preview is no longer available.')
    expect(w.text()).toContain('foto.png')
    expect(w.get('a[aria-label="Download: foto.png"]').attributes('href')).toBe(image.url)
    expect(w.findAll('li')).toHaveLength(2)
    expect(w.findAll('[role="status"]')).toHaveLength(1)
    expect(w.get('[role="status"]').text()).toBe('The preview is no longer available.')
  })

  it('retries the preview when the same attachment arrives with a new signed url', async () => {
    const w = render([image])
    await w.get('img').trigger('error')
    await flushPromises()
    expect(w.find('img').exists()).toBe(false)
    const fresh = { ...image, url: 'http://api/attachments/1?sig=new' }
    await w.setProps({ attachments: [fresh] })
    expect(w.get('img').attributes('src')).toBe(fresh.url)
  })

  it('requests a new url on error and paints with it', async () => {
    renew.mockResolvedValue({ url: 'http://api/attachments/1?sig=renewed', expires_at: '2026-03-04T10:35:00Z' })
    const w = render([image])
    await w.get('img').trigger('error')
    await flushPromises()
    expect(renew).toHaveBeenCalledExactlyOnceWith(1)
    expect(w.get('img').attributes('src')).toBe('http://api/attachments/1?sig=renewed')
    expect(w.get('[role="status"]').text()).toBe('')
  })

  it('keeps the failed state when the renewed url fails too, without looping', async () => {
    renew.mockResolvedValue({ url: 'http://api/attachments/1?sig=renewed', expires_at: '2026-03-04T10:35:00Z' })
    const w = render([image])
    await w.get('img').trigger('error')
    await flushPromises()
    await w.get('img').trigger('error')
    await flushPromises()
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toContain('The preview is no longer available.')
    expect(renew).toHaveBeenCalledTimes(1)
  })

  it('keeps the failed state when the API answers 404', async () => {
    const w = render([image])
    await w.get('img').trigger('error')
    await flushPromises()
    expect(renew).toHaveBeenCalledTimes(1)
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toContain('The preview is no longer available.')
  })

  it('retries again, once, when the store delivers a new url after a failure', async () => {
    const w = render([image])
    await w.get('img').trigger('error')
    await flushPromises()
    expect(w.find('img').exists()).toBe(false)
    const fresh = { ...image, url: 'http://api/attachments/1?sig=new' }
    await w.setProps({ attachments: [fresh] })
    renew.mockResolvedValue({ url: 'http://api/attachments/1?sig=renewed2', expires_at: '2026-03-04T10:35:00Z' })
    await w.get('img').trigger('error')
    await flushPromises()
    expect(renew).toHaveBeenCalledTimes(2)
    expect(w.get('img').attributes('src')).toBe('http://api/attachments/1?sig=renewed2')
  })

  it('clears the notice when the store delivers a new url that loads', async () => {
    const w = render([image])
    await w.get('img').trigger('error')
    await flushPromises()
    expect(w.get('[role="status"]').text()).toBe('The preview is no longer available.')
    await w.setProps({ attachments: [{ ...image, url: 'http://api/attachments/1?sig=new' }] })
    expect(w.find('img').exists()).toBe(true)
    expect(w.get('[role="status"]').text()).toBe('')
  })

  it('keeps the notice while another attachment still has a current failure', async () => {
    const other = { ...image, id: 3, url: 'http://api/attachments/3?sig=c' }
    const w = render([image, other])
    await w.findAll('img')[0].trigger('error')
    await flushPromises()
    await w.get('img').trigger('error')
    await flushPromises()
    await w.setProps({ attachments: [{ ...image, url: 'http://api/attachments/1?sig=new' }, other] })
    expect(w.get('img').attributes('src')).toBe('http://api/attachments/1?sig=new')
    expect(w.get('[role="status"]').text()).toBe('The preview is no longer available.')
  })

  it('drops a renewed url when the store delivers a different one', async () => {
    renew.mockResolvedValue({ url: 'http://api/attachments/1?sig=renewed', expires_at: '2026-03-04T10:35:00Z' })
    const w = render([image])
    await w.get('img').trigger('error')
    await flushPromises()
    const fresh = { ...image, url: 'http://api/attachments/1?sig=new' }
    await w.setProps({ attachments: [fresh] })
    expect(w.get('img').attributes('src')).toBe(fresh.url)
  })

  describe('click', () => {
    const fresh = { url: 'http://api/attachments/1?sig=fresh', expires_at: '2026-03-04T10:35:00Z' }

    function fakeWindow() {
      const win = { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
      const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
      return { win, open }
    }

    it('opens a window in the gesture and points it to a fresh url', async () => {
      renew.mockResolvedValue(fresh)
      const { win, open } = fakeWindow()
      const w = render([image])
      await w.get('a').trigger('click')
      expect(open).toHaveBeenCalledExactlyOnceWith('', '_blank')
      expect(win.opener).toBeNull()
      await flushPromises()
      expect(renew).toHaveBeenCalledExactlyOnceWith(1)
      expect(win.location.href).toBe(fresh.url)
      expect(win.close).not.toHaveBeenCalled()
    })

    it('closes the window and shows a toast when the url cannot be renewed', async () => {
      const { win } = fakeWindow()
      const w = render([image])
      await w.get('a').trigger('click')
      await flushPromises()
      expect(win.location.href).toBe('')
      expect(win.close).toHaveBeenCalledOnce()
      expect(toasts.value.map((item) => [item.kind, item.message])).toEqual([
        ['error', 'Could not open the file. It may no longer be available.'],
      ])
    })

    it.each([
      ['a network error', new TypeError('Failed to fetch')],
      ['a 500', new ApiError(500, 'boom')],
    ])('shows the retry toast on %s', async (_label, error) => {
      renew.mockRejectedValue(error)
      fakeWindow()
      const w = render([image])
      await w.get('a').trigger('click')
      await flushPromises()
      expect(toasts.value.map((item) => item.message)).toEqual([
        'Could not open the file. Check your connection and try again.',
      ])
    })

    it('shows a toast when the popup is blocked in the gesture and again after the request', async () => {
      renew.mockResolvedValue(fresh)
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      const w = render([image])
      await w.get('a').trigger('click')
      await flushPromises()
      expect(open).toHaveBeenNthCalledWith(2, fresh.url, '_blank')
      expect(toasts.value.map((item) => [item.kind, item.message])).toEqual([
        ['error', 'Your browser blocked the new tab. Allow pop-ups for this site and try again.'],
      ])
    })

    it('opens the fallback window without a toast when only the gesture window was blocked', async () => {
      renew.mockResolvedValue(fresh)
      const win = { opener: {} as unknown }
      const open = vi.spyOn(window, 'open').mockReturnValueOnce(null).mockReturnValueOnce(win as unknown as Window)
      const w = render([image])
      await w.get('a').trigger('click')
      await flushPromises()
      expect(open).toHaveBeenNthCalledWith(2, fresh.url, '_blank')
      expect(win.opener).toBeNull()
      expect(toasts.value).toHaveLength(0)
    })

    it('leaves native behaviour for modified clicks', async () => {
      const { open } = fakeWindow()
      const w = render([image])
      const a = w.get('a')
      await a.trigger('click', { ctrlKey: true })
      await a.trigger('click', { metaKey: true })
      await a.trigger('click', { shiftKey: true })
      await a.trigger('click', { button: 1 })
      expect(open).not.toHaveBeenCalled()
      expect(renew).not.toHaveBeenCalled()
    })

    it('navigates to a fresh url from the download link', async () => {
      renew.mockResolvedValue({ ...fresh, url: 'http://api/attachments/2?sig=fresh' })
      const assign = vi.fn()
      vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location)
      const w = render([pdf])
      await w.get('a').trigger('click')
      await flushPromises()
      expect(renew).toHaveBeenCalledExactlyOnceWith(2)
      expect(assign).toHaveBeenCalledExactlyOnceWith('http://api/attachments/2?sig=fresh')
    })

    it.each([
      ['a 404', new ApiError(404, 'gone'), 'Could not open the file. It may no longer be available.'],
      ['a network error', new TypeError('Failed to fetch'), 'Could not open the file. Check your connection and try again.'],
      ['a 500', new ApiError(500, 'boom'), 'Could not open the file. Check your connection and try again.'],
    ])('shows the matching toast when the download url cannot be renewed by %s', async (_label, error, message) => {
      renew.mockRejectedValue(error)
      const assign = vi.fn()
      vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location)
      const w = render([pdf])
      await w.get('a').trigger('click')
      await flushPromises()
      expect(assign).not.toHaveBeenCalled()
      expect(toasts.value.map((item) => item.message)).toEqual([message])
    })

    it('uses the renewed url as the fallback href', async () => {
      renew.mockResolvedValue({ ...fresh, url: 'http://api/attachments/1?sig=renewed' })
      const w = render([image])
      await w.get('img').trigger('error')
      await flushPromises()
      expect(w.get('a').attributes('href')).toBe('http://api/attachments/1?sig=renewed')
    })
  })
  it('renews through the renewUrl prop instead of the chat endpoint', async () => {
    const renewUrl = vi.fn().mockResolvedValue({ url: 'http://api/task-attachments/1?sig=renewed', expires_at: '2026-03-04T10:35:00Z' })
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location)
    const w = mount(MessageAttachments, { props: { attachments: [image, pdf], renewUrl }, global: { plugins: [i18n] } })
    await w.get('img').trigger('error')
    await flushPromises()
    expect(w.get('img').attributes('src')).toBe('http://api/task-attachments/1?sig=renewed')
    await w.get('.message-attachment__download').trigger('click')
    await flushPromises()
    expect(renewUrl.mock.calls).toEqual([[1], [2]])
    expect(assign).toHaveBeenCalledExactlyOnceWith('http://api/task-attachments/1?sig=renewed')
    expect(renew).not.toHaveBeenCalled()
  })

  describe('on desktop', () => {
    const fresh = { url: 'http://api/attachments/9?sig=fresh', expires_at: '2026-03-04T10:35:00Z' }
    let open: ReturnType<typeof vi.fn>
    let assign: ReturnType<typeof vi.fn>

    beforeEach(() => {
      vi.stubGlobal('isTauri', true)
      openUrl.mockReset().mockResolvedValue(undefined)
      renew.mockResolvedValue(fresh)
      open = vi.fn()
      assign = vi.fn()
      vi.stubGlobal('open', open)
      vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('opens the freshly requested url of a preview with the system browser', async () => {
      const w = render([image])
      await w.get('a').trigger('click')
      await flushPromises()
      expect(renew).toHaveBeenCalledExactlyOnceWith(1)
      expect(openUrl).toHaveBeenCalledExactlyOnceWith(fresh.url)
      expect(open).not.toHaveBeenCalled()
      expect(assign).not.toHaveBeenCalled()
    })

    it('downloads through the system browser', async () => {
      const w = render([pdf])
      await w.get('a').trigger('click')
      await flushPromises()
      expect(openUrl).toHaveBeenCalledExactlyOnceWith(fresh.url)
      expect(open).not.toHaveBeenCalled()
      expect(assign).not.toHaveBeenCalled()
    })

    it('prevents the default navigation so the global link listener does not open it twice', async () => {
      const w = render([image])
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
      w.get('a').element.dispatchEvent(event)
      await flushPromises()
      expect(event.defaultPrevented).toBe(true)
    })

    it('shows an error when the url cannot be renewed', async () => {
      renew.mockRejectedValue(new ApiError(404, 'gone'))
      const w = render([image])
      await w.get('a').trigger('click')
      await flushPromises()
      expect(openUrl).not.toHaveBeenCalled()
      expect(toasts.value).toHaveLength(1)
    })

    it('shows the system browser toast, not the retry one, when it fails to open', async () => {
      openUrl.mockRejectedValue(new Error('boom'))
      const w = render([pdf])
      await w.get('a').trigger('click')
      await flushPromises()
      expect(toasts.value.map((item) => item.message)).toEqual(['Could not open the file in your system browser.'])
    })

    it('shows the system browser toast when a preview fails to open', async () => {
      openUrl.mockRejectedValue(new Error('boom'))
      const w = render([image])
      await w.get('a').trigger('click')
      await flushPromises()
      expect(toasts.value.map((item) => item.message)).toEqual(['Could not open the file in your system browser.'])
    })

    it('still shows the signed url toast when the url cannot be renewed', async () => {
      renew.mockRejectedValue(new TypeError('Failed to fetch'))
      const w = render([image])
      await w.get('a').trigger('click')
      await flushPromises()
      expect(toasts.value.map((item) => item.message)).toEqual([
        'Could not open the file. Check your connection and try again.',
      ])
    })

    describe('with the external link listener installed', () => {
      let listeners: Array<[string, EventListenerOrEventListenerObject]>

      beforeEach(() => {
        listeners = []
        const add = document.addEventListener.bind(document)
        vi.spyOn(document, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
          listeners.push([type, listener])
          add(type, listener, options)
        })
        installExternalLinks()
      })

      afterEach(() => {
        for (const [type, listener] of listeners) document.removeEventListener(type, listener)
      })

      it('opens the new url exactly once on a plain click on the thumbnail', async () => {
        const w = mount(MessageAttachments, { props: { attachments: [image] }, global: { plugins: [i18n] }, attachTo: document.body })
        w.get('a').element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
        await flushPromises()
        expect(openUrl).toHaveBeenCalledExactlyOnceWith(fresh.url)
        w.unmount()
      })

      it('opens the stored href, possibly expired, on a ctrl+click without renewing', async () => {
        const w = mount(MessageAttachments, { props: { attachments: [image] }, global: { plugins: [i18n] }, attachTo: document.body })
        w.get('a').element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }))
        await flushPromises()
        expect(renew).not.toHaveBeenCalled()
        expect(openUrl).toHaveBeenCalledExactlyOnceWith(image.url)
        w.unmount()
      })
    })
  })
})
