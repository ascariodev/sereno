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

export type MessagePayload =
  | {
      type: 'log.group_opened' | 'log.group_reopened'
      log_group_id: number
      level: string
      title: string
      events_count: number
    }
  | {
      type: 'log.group_status_changed'
      log_group_id: number
      status: LogGroupStatus
      previous_status: LogGroupStatus
    }
  | { type: string; [key: string]: unknown }

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
