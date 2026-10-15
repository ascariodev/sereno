import * as SecureStore from 'expo-secure-store'

export const TOKEN_STORAGE_KEY = 'sereno.token'
export const LOCALE_STORAGE_KEY = 'sereno.locale'
export const ORGANIZATION_STORAGE_KEY = 'sereno.organization'
export const PUSH_PROMPTED_STORAGE_KEY = 'sereno.pushPrompted'

export async function readStored(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key)
  } catch {
    return null
  }
}

export async function writeStored(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value)
}

export async function removeStored(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key)
  } catch {
    // nothing to remove or storage unavailable: the in-memory session is already cleared
  }
}
