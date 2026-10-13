import { api, ApiError } from './client'
import type { PushSubscriptionPayload, PushSubscriptionRecord } from './types'

export async function getVapidPublicKey(): Promise<string> {
  return (await api.get<{ data: { public_key: string } }>('/api/push/vapid-public-key')).data.public_key
}

export async function storePushSubscription(payload: PushSubscriptionPayload): Promise<PushSubscriptionRecord> {
  return (await api.post<{ data: PushSubscriptionRecord }>('/api/me/push-subscriptions', payload)).data
}

// The client's DELETE has no body; the API reads `endpoint` from the query string.
export async function deletePushSubscription(endpoint: string): Promise<void> {
  try {
    await api.delete('/api/me/push-subscriptions', { query: { endpoint } })
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error
  }
}
