import { api } from './client'
import type { AccessToken, AccessTokenExpiryDays, CreatedAccessToken, DataEnvelope } from './types'

export async function listAccessTokens(signal?: AbortSignal): Promise<AccessToken[]> {
  const response = await api.get<DataEnvelope<AccessToken[]>>('/api/access-tokens', { signal })
  return response.data
}

export async function createAccessToken(name: string, expiresInDays: AccessTokenExpiryDays | null): Promise<CreatedAccessToken> {
  return api.post<CreatedAccessToken>('/api/access-tokens', { name, expires_in_days: expiresInDays })
}

export async function revokeAccessToken(id: number): Promise<void> {
  await api.delete<void>(`/api/access-tokens/${id}`)
}
