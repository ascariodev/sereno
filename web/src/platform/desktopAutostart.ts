import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'

export async function autostartEnabled(): Promise<boolean> {
  try {
    return await isEnabled()
  } catch {
    return false
  }
}

export async function setAutostart(enabled: boolean): Promise<boolean> {
  if (enabled) await enable()
  else await disable()
  return isEnabled()
}
