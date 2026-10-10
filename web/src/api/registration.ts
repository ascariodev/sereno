import { api } from './client'

export async function registrationStatus(signal?: AbortSignal): Promise<boolean> {
  const response = await api.get<{ enabled: boolean }>('/api/auth/registration', { signal })
  return response.enabled
}
