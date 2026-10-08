import Echo from 'laravel-echo'
import Pusher, { type ChannelAuthorizationCallback } from 'pusher-js'
import type { Message } from '../api/types'
import { config } from '../config'

export const MESSAGE_CREATED_EVENT = '.message.created'
export const MEMBERSHIP_REVOKED_EVENT = '.membership.revoked'

export interface RealtimePayload {
  message?: Message
  organization_id?: number
}

export interface RealtimeClient {
  private(name: string): { listen(event: string, callback: (data: RealtimePayload) => void): unknown }
  leave(name: string): void
  disconnect(): void
  connectionStatus(): ConnectionStatus
  onConnectionChange(callback: (status: ConnectionStatus) => void): () => void
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'failed'

type Fetch = typeof fetch
type Subscriber = (value: never) => void

let getToken: () => string | null | undefined = () => null
let client: RealtimeClient | null = null
const subscriptions = new Map<string, { client: RealtimeClient; callbacks: Set<Subscriber> }>()
let factory: () => RealtimeClient | null = createEchoClient

export function setRealtimeTokenProvider(provider: () => string | null | undefined): void {
  getToken = provider
}

export function setRealtimeClientFactory(newFactory: (() => RealtimeClient | null) | null): void {
  disconnectRealtime()
  factory = newFactory ?? createEchoClient
}

export function channelName(organizationId: number, channelId: number): string {
  return `organizations.${organizationId}.channels.${channelId}`
}

export function userChannelName(userId: number): string {
  return `users.${userId}`
}

function subscribe<T>(
  name: string,
  event: string,
  extract: (data: RealtimePayload) => T | undefined,
  onValue: (value: T) => void,
): () => void {
  client ??= factory()
  const current = client
  if (current === null) return () => {}
  let entry = subscriptions.get(name)
  if (!entry || entry.client !== current) {
    const callbacks = new Set<Subscriber>()
    current.private(name).listen(event, (data) => {
      const value = data ? extract(data) : undefined
      if (value === undefined) return
      for (const callback of [...callbacks]) {
        try {
          ;(callback as (value: T) => void)(value)
        } catch (error) {
          queueMicrotask(() => {
            throw error
          })
        }
      }
    })
    entry = { client: current, callbacks }
    subscriptions.set(name, entry)
  }
  const { callbacks } = entry
  const subscriber = (value: T) => onValue(value)
  callbacks.add(subscriber as Subscriber)
  return () => {
    if (!callbacks.delete(subscriber as Subscriber) || callbacks.size > 0) return
    if (subscriptions.get(name)?.callbacks !== callbacks) return
    subscriptions.delete(name)
    current.leave(name)
  }
}

export function subscribeToChannel(
  organizationId: number,
  channelId: number,
  onMessage: (message: Message) => void,
): () => void {
  return subscribe(channelName(organizationId, channelId), MESSAGE_CREATED_EVENT, (data) => data.message, onMessage)
}

export function subscribeToUser(userId: number, onMembershipRevoked: (organizationId: number) => void): () => void {
  return subscribe(userChannelName(userId), MEMBERSHIP_REVOKED_EVENT, (data) => data.organization_id, onMembershipRevoked)
}

export function leaveOrganization(organizationId: number): void {
  const prefix = `organizations.${organizationId}.`
  for (const [name, entry] of [...subscriptions]) {
    if (!name.startsWith(prefix)) continue
    subscriptions.delete(name)
    entry.callbacks.clear()
    entry.client.leave(name)
  }
}

export function onReconnect(callback: () => void): () => void {
  client ??= factory()
  const current = client
  if (current === null) return () => {}
  let wasConnected = current.connectionStatus() === 'connected'
  let dropped = false
  return current.onConnectionChange((status) => {
    if (status !== 'connected') {
      dropped = wasConnected
      return
    }
    if (dropped) callback()
    wasConnected = true
    dropped = false
  })
}

export function disconnectRealtime(): void {
  const current = client
  client = null
  subscriptions.clear()
  current?.disconnect()
}

export function createAuthorizer(fetchImpl: Fetch = (...args) => globalThis.fetch(...args)) {
  return (params: { socketId: string; channelName: string }, callback: ChannelAuthorizationCallback): void => {
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' }
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
    fetchImpl(`${config.apiUrl}/broadcasting/auth`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ socket_id: params.socketId, channel_name: params.channelName }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Broadcasting auth failed with status ${response.status}`)
        return response.json()
      })
      .then(
        (data) => callback(null, data),
        (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), null),
      )
  }
}

function createEchoClient(): RealtimeClient | null {
  const { key, host, port, scheme } = config.reverb
  if (!key) return null
  const echo = new Echo({
    broadcaster: 'reverb',
    key,
    Pusher,
    wsHost: host,
    wsPort: port,
    wssPort: port,
    forceTLS: scheme === 'https',
    enabledTransports: ['ws', 'wss'],
    withoutInterceptors: true,
    channelAuthorization: { customHandler: createAuthorizer() },
  })
  return {
    private: (name) => echo.private(name),
    leave: (name) => echo.leave(name),
    disconnect: () => echo.disconnect(),
    connectionStatus: () => echo.connectionStatus(),
    onConnectionChange: (callback) => echo.connector.onConnectionChange(callback),
  }
}
