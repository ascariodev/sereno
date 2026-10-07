import Echo from 'laravel-echo'
import Pusher, { type ChannelAuthorizationCallback } from 'pusher-js'
import type { Message } from '../api/types'
import { config } from '../config'

export const MESSAGE_CREATED_EVENT = '.message.created'

export interface RealtimeClient {
  private(name: string): { listen(event: string, callback: (data: { message: Message }) => void): unknown }
  leave(name: string): void
  disconnect(): void
  connectionStatus(): ConnectionStatus
  onConnectionChange(callback: (status: ConnectionStatus) => void): () => void
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'failed'

type Fetch = typeof fetch

let getToken: () => string | null | undefined = () => null
let client: RealtimeClient | null = null
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

export function subscribeToChannel(
  organizationId: number,
  channelId: number,
  onMessage: (message: Message) => void,
): () => void {
  client ??= factory()
  const current = client
  if (current === null) return () => {}
  const name = channelName(organizationId, channelId)
  current.private(name).listen(MESSAGE_CREATED_EVENT, (data) => {
    if (data?.message) onMessage(data.message)
  })
  return () => current.leave(name)
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
