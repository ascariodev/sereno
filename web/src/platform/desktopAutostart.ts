import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'

/** Whether Sereno starts with Windows; false when it cannot be read. */
export async function autostartEnabled(): Promise<boolean> {
  try {
    return await isEnabled()
  } catch {
    return false
  }
}

/** Turns the start with Windows on or off and returns the state the system reports afterwards; rejects if it fails. */
export async function setAutostart(enabled: boolean): Promise<boolean> {
  if (enabled) await enable()
  else await disable()
  return isEnabled()
}
