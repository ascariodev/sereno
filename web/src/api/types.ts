export interface User {
  id: number
  name: string
  email: string
  locale: string | null
}

export interface LoginResponse {
  token: string
  user: User
}

export interface Organization {
  id: number
  name: string
  slug: string
  settings: Record<string, unknown> | null
  roles: string[]
}

export interface Project {
  id: number
  name: string
  key: string
  description: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface Channel {
  id: number
  project_id: number
  name: string
  archived_at: string | null
  created_at: string
  project: Pick<Project, 'id' | 'name' | 'key'>
}

export type LogGroupStatus = 'open' | 'resolved' | 'ignored'

export function isLogGroupStatus(value: unknown): value is LogGroupStatus {
  return value === 'open' || value === 'resolved' || value === 'ignored'
}

export interface LogEvent {
  id: number
  level: string
  message: string
  context: Record<string, unknown> | unknown[] | null
  occurred_at: string
  received_at: string
}

export interface LogGroup {
  id: number
  project_id: number
  level: string
  title: string
  status: LogGroupStatus
  events_count: number
  first_seen_at: string
  last_seen_at: string
  events?: LogEvent[]
}

export interface LogGroupOpenedPayload {
  type: 'log.group_opened' | 'log.group_reopened'
  log_group_id: number
  level: string
  title: string
  events_count: number
}

export interface LogGroupStatusChangedPayload {
  type: 'log.group_status_changed'
  log_group_id: number
  status: LogGroupStatus
  previous_status: LogGroupStatus
}

export interface UnknownPayload {
  type: string
  [key: string]: unknown
}

export type MessagePayload = LogGroupOpenedPayload | LogGroupStatusChangedPayload | UnknownPayload

export function isLogGroupOpenedPayload(payload: MessagePayload | null): payload is LogGroupOpenedPayload {
  return (
    (payload?.type === 'log.group_opened' || payload?.type === 'log.group_reopened') &&
    typeof payload.log_group_id === 'number' &&
    typeof payload.title === 'string' &&
    typeof payload.level === 'string' &&
    typeof payload.events_count === 'number'
  )
}

export function isLogGroupStatusChangedPayload(
  payload: MessagePayload | null,
): payload is LogGroupStatusChangedPayload {
  return (
    payload?.type === 'log.group_status_changed' &&
    typeof payload.log_group_id === 'number' &&
    typeof payload.status === 'string' &&
    typeof payload.previous_status === 'string'
  )
}

export interface Message {
  id: number
  channel_id: number
  kind: 'user' | 'system'
  body: string | null
  payload: MessagePayload | null
  log_group_id: number | null
  user: Pick<User, 'id' | 'name'> | null
  created_at: string
}

export interface DataEnvelope<T> {
  data: T
}

export interface Paginated<T> {
  data: T[]
  links: Record<string, string | null>
  meta: { current_page: number; last_page: number; per_page: number; total: number }
}

export interface CursorPage<T> {
  data: T[]
  meta: { next_cursor: string | null; [key: string]: unknown }
}

export type FieldErrors = Record<string, string[]>
