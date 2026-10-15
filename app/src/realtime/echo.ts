import Echo from 'laravel-echo'
import Pusher, { type ChannelAuthorizationCallback } from 'pusher-js/react-native'

import { config } from '@/config'
import type { Message, MessageDeletedEvent } from '@/messages/store'
import type { TaskComment } from '@/tasks/comments'
import { isTaskStatus, type Task } from '@/tasks/store'

export const MEMBERSHIP_REVOKED_EVENT = '.membership.revoked'
export const MEMBERSHIP_ROLE_CHANGED_EVENT = '.membership.role_changed'
export const PROJECT_ACCESS_CHANGED_EVENT = '.project.access_changed'
export const TASK_ASSIGNED_EVENT = '.task.assigned'
export const NOTIFICATION_CREATED_EVENT = '.notification.created'
export const MENTION_REMOVED_EVENT = '.mention.removed'
export const MESSAGE_CREATED_EVENT = '.message.created'
export const MESSAGE_UPDATED_EVENT = '.message.updated'
export const MESSAGE_DELETED_EVENT = '.message.deleted'
export const TASK_CREATED_EVENT = '.task.created'
export const TASK_UPDATED_EVENT = '.task.updated'
export const TASK_DELETED_EVENT = '.task.deleted'
export const TASK_COMMENT_CREATED_EVENT = '.task.comment.created'
export const TASK_COMMENT_UPDATED_EVENT = '.task.comment.updated'
export const TASK_COMMENT_DELETED_EVENT = '.task.comment.deleted'
export const PROJECT_MEMBERS_CHANGED_EVENT = '.project.members_changed'
export const ORGANIZATION_MEMBERS_CHANGED_EVENT = '.organization.members_changed'
export const LOG_SOURCE_CONNECTED_EVENT = '.log_source.connected'

export interface RealtimePayload {
  organization_id?: number
  role?: string
  project_id?: number
  task_id?: number
  granted?: boolean
  notification?: unknown
  message?: Message
  channel_id?: number
  parent_id?: number | null
  id?: number
  message_id?: number
  deleted_at?: string
  last_used_at?: string
  root?: { id?: number; replies_count?: number; last_reply_at?: string | null; recent_participants?: { id: number; name: string }[] }
  task?: Partial<Task>
  comment?: Partial<TaskComment>
  comments_count?: unknown
}

export interface NotificationCreatedPayload {
  organizationId: number
  /** Raw item of `NotificationResource`; the consumer validates its shape. */
  notification: unknown
}

export interface MentionRemovedPayload {
  organizationId: number
  messageId: number
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

export function channelName(organizationId: number, channelId: number): string {
  return `organizations.${organizationId}.channels.${channelId}`
}

export function projectChannelName(organizationId: number, projectId: number): string {
  return `organizations.${organizationId}.projects.${projectId}`
}

export function organizationMembersChannelName(organizationId: number): string {
  return `organizations.${organizationId}.members`
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
  onMentionRemoved?: (payload: MentionRemovedPayload) => void
}

export function subscribeToUser(userId: number, handlers: UserSubscriptionHandlers = {}): () => void {
  const {
    onMembershipRevoked = () => {},
    onRoleChanged = () => {},
    onProjectAccessChanged = () => {},
    onTaskAssigned = () => {},
    onNotificationCreated = () => {},
    onMentionRemoved = () => {},
  } = handlers
  const events = [
    MEMBERSHIP_REVOKED_EVENT,
    MEMBERSHIP_ROLE_CHANGED_EVENT,
    PROJECT_ACCESS_CHANGED_EVENT,
    TASK_ASSIGNED_EVENT,
    NOTIFICATION_CREATED_EVENT,
    MENTION_REMOVED_EVENT,
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
    } else if (event === MENTION_REMOVED_EVENT) {
      if (typeof data.message_id === 'number') onMentionRemoved({ organizationId: data.organization_id, messageId: data.message_id })
    }
  })
}

export interface ChannelSubscriptionHandlers {
  onCreated?: (message: Message) => void
  onUpdated?: (message: Message) => void
  onDeleted?: (event: MessageDeletedEvent) => void
}

export function subscribeToChannel(
  organizationId: number,
  channelId: number,
  handlers: ChannelSubscriptionHandlers,
): () => void {
  const { onCreated = () => {}, onUpdated = () => {}, onDeleted = () => {} } = handlers
  const events = [MESSAGE_CREATED_EVENT, MESSAGE_UPDATED_EVENT, MESSAGE_DELETED_EVENT]
  return subscribe(channelName(organizationId, channelId), events, (event, data) => {
    if (event === MESSAGE_DELETED_EVENT) {
      const { id, channel_id: deletedChannelId, parent_id: parentId, deleted_at: deletedAt } = data
      if (typeof id !== 'number' || typeof deletedChannelId !== 'number' || typeof deletedAt !== 'string') return
      const root = data.root
      const validRoot = typeof root?.id === 'number' && typeof root.replies_count === 'number'
      onDeleted({
        id,
        channel_id: deletedChannelId,
        parent_id: typeof parentId === 'number' ? parentId : null,
        deleted_at: deletedAt,
        ...(validRoot
          ? {
              root: {
                id: root.id as number,
                replies_count: root.replies_count as number,
                last_reply_at: typeof root.last_reply_at === 'string' ? root.last_reply_at : null,
                recent_participants: root.recent_participants,
              },
            }
          : {}),
      })
      return
    }
    if (typeof data.message?.id !== 'number' || typeof data.message.channel_id !== 'number') return
    if (event === MESSAGE_UPDATED_EVENT) onUpdated(data.message)
    else onCreated(data.message)
  })
}

export interface TaskDeletedEvent {
  id: number
  project_id: number
}

export interface TaskCommentDeletedEvent {
  id: number
  task_id: number
  comments_count: number
}

export interface ProjectSubscriptionHandlers {
  onTaskCreated?: (task: Task) => void
  onTaskUpdated?: (task: Task) => void
  onTaskDeleted?: (event: TaskDeletedEvent) => void
  onTaskCommentCreated?: (comment: TaskComment, commentsCount?: number) => void
  onTaskCommentUpdated?: (comment: TaskComment) => void
  onTaskCommentDeleted?: (event: TaskCommentDeletedEvent) => void
  onLogSourceConnected?: (event: LogSourceConnectedEvent) => void
  onMembersChanged?: (projectId: number) => void
}

export interface LogSourceConnectedEvent {
  id: number
  project_id: number
  last_used_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validTask(task: Partial<Task> | undefined): task is Task {
  return (
    typeof task?.id === 'number' &&
    typeof task.project_id === 'number' &&
    isTaskStatus(task.status) &&
    typeof task.title === 'string' &&
    typeof task.updated_at === 'string'
  )
}

function validComment(comment: Partial<TaskComment> | undefined): comment is TaskComment {
  return (
    typeof comment?.id === 'number' &&
    typeof comment.task_id === 'number' &&
    typeof comment.body === 'string' &&
    typeof comment.created_at === 'string' &&
    (comment.edited_at === null || typeof comment.edited_at === 'string') &&
    (comment.user === null || (isRecord(comment.user) && typeof comment.user.id === 'number' && typeof comment.user.name === 'string')) &&
    Array.isArray(comment.mentions) &&
    comment.mentions.every((m) => isRecord(m) && typeof m.id === 'number' && typeof m.name === 'string') &&
    Array.isArray(comment.attachments) &&
    comment.attachments.every(
      (a) => isRecord(a) && typeof a.id === 'number' && typeof a.original_name === 'string' && typeof a.url === 'string',
    )
  )
}

export function subscribeToProject(
  organizationId: number,
  projectId: number,
  handlers: ProjectSubscriptionHandlers,
): () => void {
  const {
    onTaskCreated = () => {},
    onTaskUpdated = () => {},
    onTaskDeleted = () => {},
    onTaskCommentCreated = () => {},
    onTaskCommentUpdated = () => {},
    onTaskCommentDeleted = () => {},
    onLogSourceConnected = () => {},
    onMembersChanged = () => {},
  } = handlers
  // Every event of the project channel, so a later subscriber (members, integrations) does not need new ones.
  const events = [
    TASK_CREATED_EVENT,
    TASK_UPDATED_EVENT,
    TASK_DELETED_EVENT,
    TASK_COMMENT_CREATED_EVENT,
    TASK_COMMENT_UPDATED_EVENT,
    TASK_COMMENT_DELETED_EVENT,
    PROJECT_MEMBERS_CHANGED_EVENT,
    LOG_SOURCE_CONNECTED_EVENT,
  ]
  return subscribe(projectChannelName(organizationId, projectId), events, (event, data) => {
    if (event === PROJECT_MEMBERS_CHANGED_EVENT) {
      if (typeof data.project_id === 'number') onMembersChanged(data.project_id)
      return
    }
    if (event === LOG_SOURCE_CONNECTED_EVENT) {
      const { id, project_id: eventProjectId, last_used_at: lastUsedAt } = data
      if (typeof id === 'number' && typeof eventProjectId === 'number' && typeof lastUsedAt === 'string') {
        onLogSourceConnected({ id, project_id: eventProjectId, last_used_at: lastUsedAt })
      }
      return
    }
    if (event === TASK_COMMENT_CREATED_EVENT) {
      if (validComment(data.comment)) {
        onTaskCommentCreated(data.comment, typeof data.comments_count === 'number' ? data.comments_count : undefined)
      }
      return
    }
    if (event === TASK_COMMENT_UPDATED_EVENT) {
      if (validComment(data.comment)) onTaskCommentUpdated(data.comment)
      return
    }
    if (event === TASK_COMMENT_DELETED_EVENT) {
      const { id, task_id: taskId, comments_count: count } = data
      if (typeof id === 'number' && typeof taskId === 'number' && typeof count === 'number') {
        onTaskCommentDeleted({ id, task_id: taskId, comments_count: count })
      }
      return
    }
    if (event === TASK_DELETED_EVENT) {
      if (typeof data.id === 'number' && typeof data.project_id === 'number') {
        onTaskDeleted({ id: data.id, project_id: data.project_id })
      }
      return
    }
    if (event !== TASK_CREATED_EVENT && event !== TASK_UPDATED_EVENT) return
    if (!validTask(data.task)) return
    if (event === TASK_UPDATED_EVENT) onTaskUpdated(data.task)
    else onTaskCreated(data.task)
  })
}

export function subscribeToOrganizationMembers(organizationId: number, onChanged: () => void): () => void {
  return subscribe(organizationMembersChannelName(organizationId), [ORGANIZATION_MEMBERS_CHANGED_EVENT], () => onChanged())
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
