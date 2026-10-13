import { api } from './client'
import type { AppNotification, NotificationPage } from './types'

export const NOTIFICATIONS_PER_PAGE = 30
/** Maximum ids the API accepts in one `POST /api/notifications/read`. */
export const NOTIFICATIONS_READ_MAX_IDS = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number'

function hasTaskFields(data: Record<string, unknown>): boolean {
  return (
    isNumber(data.task_id) &&
    isString(data.task_key) &&
    isString(data.task_title) &&
    isNumber(data.actor_id) &&
    isString(data.actor_name)
  )
}

function hasCommentFields(data: Record<string, unknown>): boolean {
  return hasTaskFields(data) && isNumber(data.comment_id) && isString(data.comment_excerpt)
}

function hasChatMentionFields(data: Record<string, unknown>): boolean {
  return (
    isNumber(data.channel_id) &&
    isString(data.channel_name) &&
    isNumber(data.message_id) &&
    (data.parent_id === null || isNumber(data.parent_id)) &&
    isString(data.message_excerpt) &&
    isNumber(data.actor_id) &&
    isString(data.actor_name)
  )
}

const DATA_GUARDS: Record<string, (data: Record<string, unknown>) => boolean> = {
  task_assigned: hasTaskFields,
  task_comment_mention: hasCommentFields,
  task_commented: hasCommentFields,
  chat_mention: hasChatMentionFields,
}

/**
 * Validates one `NotificationResource` item. Returns null when the common fields are malformed (the row is unusable);
 * an unknown `type`, or a known one whose `data` misses a field the views use, comes back as the generic variant.
 */
export function parseNotification(raw: unknown): AppNotification | null {
  if (!isRecord(raw)) return null
  const { id, type, project_id: projectId, data, read_at: readAt, created_at: createdAt } = raw
  if (!isNumber(id) || !isString(type) || !isRecord(data) || !isString(createdAt)) return null
  if (projectId !== null && !isNumber(projectId)) return null
  if (readAt !== null && !isString(readAt)) return null
  const base = { id, project_id: projectId, read_at: readAt, created_at: createdAt }
  if (Object.hasOwn(DATA_GUARDS, type) && DATA_GUARDS[type](data)) return { ...base, type, data } as AppNotification
  return { ...base, type: 'unknown', original_type: type, data }
}

export async function listNotifications(
  params: { cursor?: string | null; perPage?: number } = {},
  signal?: AbortSignal,
): Promise<NotificationPage> {
  const page = await api.get<{ data: unknown[]; meta: NotificationPage['meta'] }>('/api/notifications', {
    query: { per_page: params.perPage, cursor: params.cursor ?? undefined },
    signal,
  })
  const rows = page.data.map(parseNotification).filter((row): row is AppNotification => row !== null)
  return { data: rows, meta: page.meta }
}

export async function markNotificationsRead(selection: { ids: number[] } | { all: true }): Promise<number> {
  const response = await api.post<{ unread_count: number }>('/api/notifications/read', selection)
  return response.unread_count
}
