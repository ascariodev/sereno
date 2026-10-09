import Echo from 'laravel-echo'
import Pusher, { type ChannelAuthorizationCallback } from 'pusher-js'
import type { Message } from '../api/types'
import { config } from '../config'

export const MESSAGE_CREATED_EVENT = '.message.created'
export const MEMBERSHIP_REVOKED_EVENT = '.membership.revoked'
export const MEMBERSHIP_ROLE_CHANGED_EVENT = '.membership.role_changed'
export const MENTION_CREATED_EVENT = '.mention.created'

export interface RealtimePayload {
  message?: Message
  organization_id?: number
  role?: string
  channel_id?: number
  parent_id?: number | null
}

export interface MentionCreatedPayload {
  organizationId: number
  channelId: number
  parentId: number | null
  message: Message
}

export interface SubscriptionErrorPayload {
  type?: string
  error?: string
  status?: number
}

export interface RealtimeClient {
  private(name: string): {
    listen(event: string, callback: (data: RealtimePayload) => void): unknown
    error(callback: (payload: SubscriptionErrorPayload) => void): unknown
  }
  join(name: string): unknown
  leave(name: string): void
  disconnect(): void
  connectionStatus(): ConnectionStatus
  onConnectionChange(callback: (status: ConnectionStatus) => void): () => void
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'failed'

type Fetch = typeof fetch
type Subscriber = (event: string, data: RealtimePayload) => void
type ChannelDeniedCallback = (organizationId: number, status: number | undefined) => void

let getToken: () => string | null | undefined = () => null
let client: RealtimeClient | null = null
const subscriptions = new Map<string, { client: RealtimeClient; callbacks: Set<Subscriber> }>()
let factory: () => RealtimeClient | null = createEchoClient
const deniedCallbacks = new Set<ChannelDeniedCallback>()
const authFailureStatuses = new Map<string, number>()

export function setRealtimeTokenProvider(provider: () => string | null | undefined): void {
  getToken = provider
}

export function setRealtimeClientFactory(newFactory: (() => RealtimeClient | null) | null): void {
  disconnectRealtime()
  factory = newFactory ?? createEchoClient
}

export function channelName(organizationId: number, channelId: number): string {
  return `${organizationChannelPrefix(organizationId)}channels.${channelId}`
}

function organizationChannelPrefix(organizationId: number): string {
  return `organizations.${organizationId}.`
}

export function userChannelName(userId: number): string {
  return `users.${userId}`
}

export function sessionChannelName(userId: number): string {
  return `sessions.${userId}`
}

function subscribe(name: string, events: string[], handler: Subscriber, presence = false): () => void {
  client ??= factory()
  const current = client
  if (current === null) return () => {}
  let entry = subscriptions.get(name)
  if (!entry || entry.client !== current) {
    const callbacks = new Set<Subscriber>()
    const channel = presence ? null : current.private(name)
    if (presence) current.join(name)
    for (const event of events) {
      channel?.listen(event, (data) => {
        if (!data) return
        for (const callback of [...callbacks]) {
          try {
            callback(event, data)
          } catch (error) {
            queueMicrotask(() => {
              throw error
            })
          }
        }
      })
    }
    entry = { client: current, callbacks }
    subscriptions.set(name, entry)
    const created = entry
    channel?.error((payload) => handleSubscriptionError(name, created, payload))
  }
  const { callbacks } = entry
  const subscriber: Subscriber = handler
  callbacks.add(subscriber)
  return () => {
    if (!callbacks.delete(subscriber) || callbacks.size > 0) return
    if (subscriptions.get(name)?.callbacks !== callbacks) return
    subscriptions.delete(name)
    current.leave(name)
  }
}

function handleSubscriptionError(
  name: string,
  entry: { client: RealtimeClient },
  payload: SubscriptionErrorPayload,
): void {
  if (subscriptions.get(name) !== entry) return
  const organizationId = organizationIdOf(name)
  if (organizationId === null) return
  subscriptions.delete(name)
  const authKey = `private-${name}`
  const authStatus = authFailureStatuses.get(authKey)
  authFailureStatuses.delete(authKey)
  entry.client.leave(name)
  const status = typeof payload?.status === 'number' ? payload.status : authStatus
  for (const callback of [...deniedCallbacks]) {
    try {
      callback(organizationId, status)
    } catch (error) {
      queueMicrotask(() => {
        throw error
      })
    }
  }
}

function organizationIdOf(name: string): number | null {
  const match = /^organizations\.(\d+)\./.exec(name)
  return match ? Number(match[1]) : null
}

export function onChannelDenied(callback: ChannelDeniedCallback): () => void {
  deniedCallbacks.add(callback)
  return () => {
    deniedCallbacks.delete(callback)
  }
}

export function subscribeToChannel(
  organizationId: number,
  channelId: number,
  onMessage: (message: Message) => void,
): () => void {
  return subscribe(channelName(organizationId, channelId), [MESSAGE_CREATED_EVENT], (_event, data) => {
    if (data.message !== undefined) onMessage(data.message)
  })
}

export interface UserSubscriptionHandlers {
  onMembershipRevoked?: (organizationId: number) => void
  onRoleChanged?: (organizationId: number, role: string) => void
  onMention?: (mention: MentionCreatedPayload) => void
}

export function subscribeToUser(userId: number, handlers: UserSubscriptionHandlers = {}): () => void {
  const { onMembershipRevoked = () => {}, onRoleChanged = () => {}, onMention = () => {} } = handlers
  const events = [MEMBERSHIP_REVOKED_EVENT, MEMBERSHIP_ROLE_CHANGED_EVENT, MENTION_CREATED_EVENT]
  return subscribe(userChannelName(userId), events, (event, data) => {
    if (typeof data.organization_id !== 'number') return
    if (event === MEMBERSHIP_REVOKED_EVENT) onMembershipRevoked(data.organization_id)
    else if (event === MEMBERSHIP_ROLE_CHANGED_EVENT) {
      if (typeof data.role === 'string') onRoleChanged(data.organization_id, data.role)
    } else if (event === MENTION_CREATED_EVENT) {
      const { message, channel_id: channelId, parent_id: parentId } = data
      if (typeof message?.id !== 'number' || typeof channelId !== 'number') return
      onMention({ organizationId: data.organization_id, channelId, parentId: typeof parentId === 'number' ? parentId : null, message })
    }
  })
}

export function joinSession(userId: number): () => void {
  return subscribe(sessionChannelName(userId), [], () => {}, true)
}

export function leaveOrganization(organizationId: number): void {
  const prefix = organizationChannelPrefix(organizationId)
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
  authFailureStatuses.clear()
  current?.disconnect()
}

export function createAuthorizer(fetchImpl: Fetch = (...args) => globalThis.fetch(...args)) {
  return (params: { socketId: string; channelName: string }, callback: ChannelAuthorizationCallback): void => {
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' }
    authFailureStatuses.delete(params.channelName)
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
    fetchImpl(`${config.apiUrl}/broadcasting/auth`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ socket_id: params.socketId, channel_name: params.channelName }),
    })
      .then((response) => {
        if (!response.ok) {
          authFailureStatuses.set(params.channelName, response.status)
          throw new Error(`Broadcasting auth failed with status ${response.status}`)
        }
        authFailureStatuses.delete(params.channelName)
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
    join: (name) => echo.join(name),
    leave: (name) => echo.leave(name),
    disconnect: () => echo.disconnect(),
    connectionStatus: () => echo.connectionStatus(),
    onConnectionChange: (callback) => echo.connector.onConnectionChange(callback),
  }
}
