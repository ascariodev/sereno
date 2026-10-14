import { create } from 'zustand'

import { api, ApiError } from '@/api/client'
import { chooseLocale, setChosenLocale, setLocale, type Locale } from '@/i18n'
import { useOrganizationStore } from '@/organization/store'
import { disconnectRealtime, setRealtimeTokenProvider } from '@/realtime/echo'

import { deviceName } from './deviceName'
import { LOCALE_STORAGE_KEY, readStored, removeStored, TOKEN_STORAGE_KEY, writeStored } from './storage'
import type { LoginResponse, User } from './types'

interface AuthState {
  token: string | null
  user: User | null
  hydrated: boolean
  hydrate(): Promise<void>
  login(email: string, password: string, explicitLocale?: Locale | null): Promise<boolean>
  register(name: string, email: string, password: string, passwordConfirmation: string): Promise<boolean>
  fetchMe(): Promise<void>
  chooseAndSaveLocale(locale: Locale): Promise<boolean>
  logout(): Promise<void>
  clearSession(): Promise<void>
}

// Bumped on login and clearSession: a response that started under another generation is discarded.
let generation = 0

export const useAuthStore = create<AuthState>()((set, get) => {
  async function saveLocale(locale: Locale): Promise<boolean> {
    const mine = generation
    try {
      const response = await api.patch<{ data: User }>('/api/me/locale', { locale })
      if (mine === generation && get().user) set({ user: response.data })
      return true
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      return false
    }
  }

  async function startSession(
    path: string,
    body: Record<string, unknown>,
    explicitLocale: Locale | null,
  ): Promise<boolean> {
    const mine = ++generation
    const response = await api.post<LoginResponse>(path, { ...body, device_name: deviceName() })
    if (mine !== generation) return true
    set({ token: response.token, user: response.user })
    try {
      await writeStored(TOKEN_STORAGE_KEY, response.token)
    } catch (error) {
      if (mine === generation) {
        set({ token: null, user: null })
        setLocale(null)
      }
      await removeStored(TOKEN_STORAGE_KEY)
      throw error
    }
    if (mine !== generation) {
      if (get().token === null) await removeStored(TOKEN_STORAGE_KEY)
      return true
    }
    if (!explicitLocale) {
      setLocale(response.user.locale)
      return true
    }
    const saved = await saveLocale(explicitLocale)
    if (mine === generation) await persistChoice(explicitLocale)
    return saved
  }

  return {
    token: null,
    user: null,
    hydrated: false,

    async hydrate() {
      const mine = generation
      const [token, locale] = await Promise.all([readStored(TOKEN_STORAGE_KEY), readStored(LOCALE_STORAGE_KEY)])
      setChosenLocale(locale)
      if (mine !== generation) {
        set({ hydrated: true })
        return
      }
      setLocale(null)
      set({ token, hydrated: true })
    },

    login(email, password, explicitLocale = null) {
      return startSession('/api/auth/login', { email, password }, explicitLocale)
    },

    register(name, email, password, passwordConfirmation) {
      return startSession(
        '/api/auth/register',
        { name, email, password, password_confirmation: passwordConfirmation },
        null,
      )
    },

    async fetchMe() {
      const mine = generation
      const response = await api.get<{ data: User }>('/api/me')
      if (mine !== generation) return
      set({ user: response.data })
      setLocale(response.data.locale)
    },

    async chooseAndSaveLocale(locale) {
      await persistChoice(locale)
      return saveLocale(locale)
    },

    async logout() {
      try {
        await api.post('/api/auth/logout')
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
      } finally {
        await get().clearSession()
      }
    },

    async clearSession() {
      generation++
      set({ token: null, user: null })
      disconnectRealtime()
      useOrganizationStore.getState().clear()
      setLocale(null)
      await removeStored(TOKEN_STORAGE_KEY)
    },
  }
})

async function persistChoice(locale: Locale): Promise<void> {
  chooseLocale(locale)
  try {
    await writeStored(LOCALE_STORAGE_KEY, locale)
  } catch {
    // the choice still applies for this run and is saved on the account
  }
}

export function installAuthOnApi(onSessionExpired?: () => void): void {
  api.setTokenProvider(() => useAuthStore.getState().token)
  setRealtimeTokenProvider(() => useAuthStore.getState().token)
  api.setUnauthorizedHandler(() => {
    void useAuthStore.getState().clearSession()
    onSessionExpired?.()
  })
}
