import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

export function isDesktop(): boolean {
  return isTauri()
}

export function openExternal(url: string): Promise<void> {
  return openUrl(url)
}

function externalHref(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null
  if (!(event.target instanceof Element)) return null
  const anchor = event.target.closest('a')
  if (!anchor || anchor.target !== '_blank') return null
  let url: URL
  try {
    url = new URL(anchor.href, window.location.href)
  } catch {
    return null
  }
  if (url.origin === window.location.origin && url.protocol !== 'mailto:') return null
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null
  return url.href
}

export function installExternalLinks(): void {
  if (!isDesktop()) return
  document.addEventListener('click', (event) => {
    const href = externalHref(event)
    if (!href) return
    event.preventDefault()
    openUrl(href).catch(() => {})
  })
}
