import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const openUrl = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }))

import { installExternalLinks, isDesktop } from './desktop'

describe('isDesktop', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is false in a browser', () => {
    expect(isDesktop()).toBe(false)
  })

  it('is true when Tauri injects its global', () => {
    vi.stubGlobal('isTauri', true)
    expect(isDesktop()).toBe(true)
  })
})

describe('installExternalLinks', () => {
  let added: Array<[string, EventListener]> = []
  const realAdd = document.addEventListener.bind(document)

  beforeEach(() => {
    openUrl.mockReset().mockResolvedValue(undefined)
    added = []
    vi.spyOn(document, 'addEventListener').mockImplementation(((type: string, fn: EventListener) => {
      added.push([type, fn])
      realAdd(type, fn)
    }) as typeof document.addEventListener)
  })

  afterEach(() => {
    for (const [type, fn] of added) document.removeEventListener(type, fn)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  function click(html: string, init: MouseEventInit = {}, type = 'click'): MouseEvent {
    document.body.innerHTML = html
    const target = document.body.querySelector('[data-t]') as HTMLElement
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
    target.dispatchEvent(event)
    return event
  }

  it('does not install in a browser', () => {
    installExternalLinks()
    expect(added).toHaveLength(0)
    click('<a data-t href="https://example.com" target="_blank">x</a>')
    expect(openUrl).not.toHaveBeenCalled()
  })

  describe('on desktop', () => {
    beforeEach(() => {
      vi.stubGlobal('isTauri', true)
      installExternalLinks()
      expect(added).toHaveLength(2)
    })

    it('opens http links in the system browser', () => {
      const event = click('<a data-t href="https://example.com/a?b=1" target="_blank">x</a>')
      expect(event.defaultPrevented).toBe(true)
      expect(openUrl).toHaveBeenCalledWith('https://example.com/a?b=1')
    })

    it('opens mailto links', () => {
      const event = click('<a data-t href="mailto:a@b.co" target="_blank">x</a>')
      expect(event.defaultPrevented).toBe(true)
      expect(openUrl).toHaveBeenCalledWith('mailto:a@b.co')
    })

    it('uses the closest anchor when the click lands on a child', () => {
      click('<a href="https://example.com" target="_blank"><span data-t>x</span></a>')
      expect(openUrl).toHaveBeenCalledWith('https://example.com/')
    })

    it('leaves same-origin links alone', () => {
      const event = click(`<a data-t href="${window.location.origin}/projects/1" target="_blank">x</a>`)
      expect(event.defaultPrevented).toBe(false)
      expect(openUrl).not.toHaveBeenCalled()
    })

    it('leaves links without target _blank alone', () => {
      const event = click('<a data-t href="https://example.com">x</a>')
      expect(event.defaultPrevented).toBe(false)
      expect(openUrl).not.toHaveBeenCalled()
    })

    it('ignores other schemes', () => {
      click('<a data-t href="javascript:void(0)" target="_blank">x</a>')
      click('<a data-t href="file:///c:/x" target="_blank">x</a>')
      expect(openUrl).not.toHaveBeenCalled()
    })

    it('opens external links on middle click (auxclick) without opening a window', () => {
      const event = click('<a data-t href="https://example.com/m" target="_blank">x</a>', { button: 1 }, 'auxclick')
      expect(event.defaultPrevented).toBe(true)
      expect(openUrl).toHaveBeenCalledTimes(1)
      expect(openUrl).toHaveBeenCalledWith('https://example.com/m')
    })

    it('does not intercept secondary click or a primary-button auxclick', () => {
      const secondary = click('<a data-t href="https://example.com" target="_blank">x</a>', { button: 2 }, 'auxclick')
      expect(secondary.defaultPrevented).toBe(false)
      const odd = click('<a data-t href="https://example.com" target="_blank">x</a>', { button: 0 }, 'auxclick')
      expect(odd.defaultPrevented).toBe(false)
      expect(openUrl).not.toHaveBeenCalled()
    })

    it('ignores non-primary buttons and already cancelled events', () => {
      click('<a data-t href="https://example.com" target="_blank">x</a>', { button: 1 })
      expect(openUrl).not.toHaveBeenCalled()
      document.body.innerHTML = '<a data-t href="https://example.com" target="_blank">x</a>'
      document.body.addEventListener('click', (e) => e.preventDefault(), { capture: true })
      document.body.querySelector('[data-t]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
      expect(openUrl).not.toHaveBeenCalled()
    })
  })
})
