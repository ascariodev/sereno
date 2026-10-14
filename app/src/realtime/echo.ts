import Echo from 'laravel-echo'
import Pusher, { type ChannelAuthorizationCallback } from 'pusher-js/react-native'

import { config } from '@/config'

export const MEMBERSHIP_REVOKED_EVENT = '.membership.revoked'
export const MEMBERSHIP_ROLE_CHANGED_EVENT = '.membership.role_changed'
export const PROJECT_ACCESS_CHANGED_EVENT = '.project.access_changed'
export const TASK_ASSIGNED_EVENT = '.task.assigned'
export const NOTIFICATION_CREATED_EVENT = '.notification.created'

export interface RealtimePayload {
  organization_id?: number
  role?: string
  project_id?: number
  task_id?: number
  granted?: boolean
  notification?: unknown
}

export interface NotificationCreatedPayload {
  organizationId: number
  /** Raw item of `NotificationResource`; the consumer validates its shape. */
  notification: unknown
}

export interface SubscriptionErrorPayload {
  type?: string
  error?: string
  status?: number
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'failed'

export interface RealtimeClient {
  private(name: string): {
    listen(event: string, callback: (data: RealtimePayload) => void): unknown
    error(callback: (payload: SubscriptionErrorPayload) => void): unknown
  }
  leave(name: string): void
  disconnect(): void
  /** Reopens the socket if the OS or the network dropped it; does nothing while connected or connecting. */
  resume(): void
  connectionStatus(): ConnectionStatus
  onConnectionChange(callback: (status: ConnectionStatus) => void): () => void
}

type Fetch = typeof fetch
type Subscriber = (event: string, data: RealtimePayload) => void

let getToken: () => string | null | undefined = () => null
let client: RealtimeClient | null = null
const subscriptions = new Map<string, { client: RealtimeClient; callbacks: Set<Subscriber>; events: string[] }>()
let factory: () => RealtimeClient | null = createEchoClient

export function setRealtimeTokenProvider(provider: () => string | null | undefined): void {
  getToken = provider
}

export function setRealtimeClientFactory(newFactory: (() => RealtimeClient | null) | null): void {
  disconnectRealtime()
  factory = newFactory ?? createEchoClient
}

export function userChannelName(userId: number): string {
  return `users.${userId}`
}

function subscribe(name: string, events: string[], handler: Subscriber): () => void {
  client ??= factory()
  const current = client
  if (current === null) return () => {}
  let entry = subscriptions.get(name)
  if (!entry || entry.client !== current) {
    const callbacks = new Set<Subscriber>()
    const channel = current.private(name)
    for (const event of events) {
      channel.listen(event, (data) => {
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
    const created = { client: current, callbacks, events: [...events] }
    entry = created
    subscriptions.set(name, created)
    channel.error(() => {
      if (subscriptions.get(name) !== created) return
      subscriptions.delete(name)
      created.client.leave(name)
    })
  } else if (__DEV__ && events.some((event) => !entry!.events.includes(event))) {
    console.warn(`Realtime channel "${name}" was opened listening to [${entry.events.join(', ')}]; a later subscriber cannot add events.`)
  }
  const { callbacks } = entry
  const subscriber: Subscriber = (event, data) => handler(event, data)
  callbacks.add(subscriber)
  return () => {
    if (!callbacks.delete(subscriber) || callbacks.size > 0) return
    if (subscriptions.get(name)?.callbacks !== callbacks) return
    subscriptions.delete(name)
    current.leave(name)
  }
}

export interface UserSubscriptionHandlers {
  onMembershipRevoked?: (organizationId: number) => void
  onRoleChanged?: (organizationId: number, role: string) => void
  onProjectAccessChanged?: (organizationId: number, projectId: number, granted: boolean) => void
  onTaskAssigned?: (organizationId: number, projectId: number, taskId: number) => void
  onNotificationCreated?: (payload: NotificationCreatedPayload) => void
}

export function subscribeToUser(userId: number, handlers: UserSubscriptionHandlers = {}): () => void {
  const {
    onMembershipRevoked = () => {},
    onRoleChanged = () => {},
    onProjectAccessChanged = () => {},
    onTaskAssigned = () => {},
    onNotificationCreated = () => {},
  } = handlers
  const events = [
    MEMBERSHIP_REVOKED_EVENT,
    MEMBERSHIP_ROLE_CHANGED_EVENT,
    PROJECT_ACCESS_CHANGED_EVENT,
    TASK_ASSIGNED_EVENT,
    NOTIFICATION_CREATED_EVENT,
  ]
  return subscribe(userChannelName(userId), events, (event, data) => {
    if (typeof data.organization_id !== 'number') return
    if (event === MEMBERSHIP_REVOKED_EVENT) onMembershipRevoked(data.organization_id)
    else if (event === MEMBERSHIP_ROLE_CHANGED_EVENT) {
      if (typeof data.role === 'string') onRoleChanged(data.organization_id, data.role)
    } else if (event === PROJECT_ACCESS_CHANGED_EVENT) {
      if (typeof data.project_id === 'number' && typeof data.granted === 'boolean') {
        onProjectAccessChanged(data.organization_id, data.project_id, data.granted)
      }
    } else if (event === TASK_ASSIGNED_EVENT) {
      if (typeof data.project_id === 'number' && typeof data.task_id === 'number') {
        onTaskAssigned(data.organization_id, data.project_id, data.task_id)
      }
    } else if (event === NOTIFICATION_CREATED_EVENT) {
      if (typeof data.notification !== 'object' || data.notification === null) return
      onNotificationCreated({ organizationId: data.organization_id, notification: data.notification })
    }
  })
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

export function resumeRealtime(): void {
  client?.resume()
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

const RESUMABLE_STATES = ['disconnected', 'unavailable', 'failed']

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
    resume: () => {
      const pusher = echo.connector.pusher
      if (RESUMABLE_STATES.includes(pusher.connection.state)) pusher.connect()
    },
    connectionStatus: () => echo.connectionStatus(),
    onConnectionChange: (callback) => echo.connector.onConnectionChange(callback),
  }
}
