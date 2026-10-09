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
  open_groups_count?: number
  open_max_level?: string | null
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

export interface HourlyCounts {
  /** ISO start of the oldest hour (UTC). */
  from: string
  hours: number
  /** Events per hour, oldest first, keyed by group id. Ids not in the project are omitted; may be `{}`. */
  counts: Record<string, number[]>
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
  title?: string
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
    (payload.title === undefined || typeof payload.title === 'string') &&
    typeof payload.status === 'string' &&
    typeof payload.previous_status === 'string'
  )
}

/** Attachment as returned by the API. `url` is signed and temporary; the upload response carries one that 404s until the attachment is sent in a message. */
export interface MessageAttachment {
  id: number
  original_name: string
  mime: string
  size: number
  /** ISO timestamp. */
  created_at: string
  url: string
}

export interface Message {
  id: number
  channel_id: number
  kind: 'user' | 'system'
  body: string | null
  payload: MessagePayload | null
  log_group_id: number | null
  /** Id of the root message when this is a reply; null for roots. Replies are one level deep. */
  parent_id: number | null
  replies_count: number
  /** ISO timestamp of the latest reply; null when the message has no replies. */
  last_reply_at: string | null
  /** Latest distinct reply authors (up to 3), newest first; `[]` unless the list endpoints filled it. */
  recent_participants: Pick<User, 'id' | 'name'>[]
  user: Pick<User, 'id' | 'name'> | null
  /** Organization members named by `<@id>` tokens in the body, except the author; others render generic. */
  mentions: { id: number; name: string }[]
  /** Always a list (`[]` without files), ordered by id. */
  attachments: MessageAttachment[]
  created_at: string
  /** ISO timestamp of the last body change; null if never edited. */
  edited_at: string | null
  /** ISO timestamp when the author deleted it; a deleted message has `body: null`, no mentions and no attachments. */
  deleted_at: string | null
}

/** Counters of the root message after a delete (`meta.root` of DELETE and `root` of `message.deleted`). */
export interface RootCounters {
  id: number
  replies_count: number
  last_reply_at: string | null
}

/** DELETE response: the deleted message; `meta.root` is present only when it was a reply. */
export interface DeleteMessageResponse {
  data: Message
  meta?: { root?: RootCounters }
}

/** Payload of the `message.deleted` event; for a root, `root` is the message itself. */
export interface MessageDeletedEvent {
  id: number
  channel_id: number
  parent_id: number | null
  deleted_at: string
  root: RootCounters
}

/** One row of the mention inbox (`MentionResource`); `id` is the mention's, not the message's. */
export interface Mention {
  id: number
  /** ISO timestamp; null while unread. */
  read_at: string | null
  created_at: string
  message: Message
  channel: { id: number; name: string; project_id: number }
  /** Root message id when the mention is in a reply; null otherwise. */
  parent_id: number | null
}

export interface MentionPage extends CursorPage<Mention> {
  meta: { next_cursor: string | null; unread_count: number }
}

export type InvitationRole = 'owner' | 'admin' | 'member'

export interface Invitation {
  id: number
  email: string
  role: InvitationRole
  locale: string
  /** Null when the inviter was deleted. */
  invited_by: { id: number; name: string } | null
  expires_at: string
  created_at: string
}

/** `role` is null if the member has no role in the active organization. */
export interface Member {
  id: number
  name: string
  email: string
  role: InvitationRole | null
  joined_at: string | null
}

export interface InvitationPreview {
  organization: { name: string }
  email: string
  role: InvitationRole
  expires_at: string
}

export interface AcceptedInvitation {
  organization_id: number
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

/** Page of `GET .../messages/{id}/replies`; `meta.root` is the thread root on every page. */
export interface RepliesPage extends CursorPage<Message> {
  meta: { next_cursor: string | null; root: Message }
}

export type FieldErrors = Record<string, string[]>
