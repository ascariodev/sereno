import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, ApiError } from '../api/client'
import type { LoginResponse, User } from '../api/types'
import { setLocale } from '../i18n'

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
  }

  async function login(email: string, password: string): Promise<void> {
    const response = await api.post<LoginResponse>('/api/auth/login', { email, password })
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

  return { token, user, isAuthenticated, login, fetchMe, logout, clearSession }
})

export function installAuthOnApi(onSessionExpired?: () => void): void {
  const auth = useAuthStore()
  api.setTokenProvider(() => auth.token)
  api.setUnauthorizedHandler(() => {
    auth.clearSession()
    onSessionExpired?.()
  })
}
