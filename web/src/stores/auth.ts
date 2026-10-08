import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, ApiError } from '../api/client'
import type { LoginResponse, User } from '../api/types'
import { chooseLocale, setLocale, type Locale } from '../i18n'
import { disconnectRealtime, setRealtimeTokenProvider } from '../realtime/echo'
import { useOrganizationStore } from './organization'

export const TOKEN_STORAGE_KEY = 'workspace.token'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_STORAGE_KEY))
  const user = ref<User | null>(null)
  const isAuthenticated = computed(() => token.value !== null)

  function clearSession(): void {
    token.value = null
    user.value = null
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setLocale(null)
    disconnectRealtime()
    useOrganizationStore().clear()
  }

  async function saveLocale(locale: Locale): Promise<boolean> {
    const sessionToken = token.value
    try {
      const response = await api.patch<{ data: User }>('/api/me/locale', { locale })
      if (token.value === sessionToken && user.value) user.value = response.data
      return true
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      return false
    }
  }

  async function chooseAndSaveLocale(locale: Locale): Promise<boolean> {
    chooseLocale(locale)
    return saveLocale(locale)
  }

  async function login(email: string, password: string, explicitLocale: Locale | null = null): Promise<boolean> {
    const response = await api.post<LoginResponse>('/api/auth/login', { email, password })
    token.value = response.token
    user.value = response.user
    localStorage.setItem(TOKEN_STORAGE_KEY, response.token)
    if (!explicitLocale) {
      setLocale(response.user.locale)
      return true
    }
    const saved = await saveLocale(explicitLocale)
    if (token.value === response.token) chooseLocale(explicitLocale)
    return saved
  }

  async function register(name: string, email: string, password: string, passwordConfirmation: string): Promise<void> {
    const response = await api.post<LoginResponse>('/api/auth/register', {
      name,
      email,
      password,
      password_confirmation: passwordConfirmation,
    })
    token.value = response.token
    user.value = response.user
    localStorage.setItem(TOKEN_STORAGE_KEY, response.token)
    setLocale(response.user.locale)
  }

  async function fetchMe(): Promise<void> {
    const response = await api.get<{ data: User }>('/api/me')
    user.value = response.data
    setLocale(response.data.locale)
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/api/auth/logout')
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
    } finally {
      clearSession()
    }
  }

  return { token, user, isAuthenticated, login, register, chooseAndSaveLocale, fetchMe, logout, clearSession }
})

export function installAuthOnApi(onSessionExpired?: () => void): void {
  const auth = useAuthStore()
  api.setTokenProvider(() => auth.token)
  setRealtimeTokenProvider(() => auth.token)
  api.setUnauthorizedHandler(() => {
    auth.clearSession()
    onSessionExpired?.()
  })
}
