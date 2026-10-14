import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { toast, toasts } from '../components/ui/toast'
import { i18n } from '../i18n'
import { isDesktop } from './desktop'

export const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000

let checking = false
let downloaded: Update | null = null
let toastId: number | null = null

function offerRestart(update: Update): void {
  if (toastId !== null && toasts.value.some((item) => item.id === toastId && item.open)) return
  toastId = toast.info(i18n.global.t('desktopUpdate.ready'), {
    duration: Number.POSITIVE_INFINITY,
    action: { label: i18n.global.t('desktopUpdate.restart'), onSelect: () => void restart(update) },
  })
}

async function restart(update: Update): Promise<void> {
  try {
    // On Windows install() launches the installer and exits; the installer reopens Sereno.
    await update.install()
    await relaunch()
  } catch (error) {
    console.warn('Desktop update could not be installed', error)
    downloaded = null
    toastId = null
    void update.close().catch(() => {})
    toast.error(i18n.global.t('desktopUpdate.installFailed'))
  }
}

/** Looks for a newer version and, if there is one, downloads it and offers to restart. Network errors stay silent. */
export async function checkForUpdate(): Promise<void> {
  if (downloaded) return offerRestart(downloaded)
  if (checking) return
  checking = true
  let update: Update | null = null
  try {
    update = await check()
    if (!update) return
    await update.download()
    downloaded = update
    offerRestart(update)
  } catch (error) {
    console.warn('Desktop update check failed', error)
    void update?.close().catch(() => {})
  } finally {
    checking = false
  }
}

/** Checks for updates now and every few hours, only in the desktop app. Returns a function that stops the timer. */
export function installDesktopUpdater(): () => void {
  if (!isDesktop()) return () => {}
  void checkForUpdate()
  const timer = setInterval(() => void checkForUpdate(), UPDATE_CHECK_INTERVAL)
  return () => clearInterval(timer)
}
