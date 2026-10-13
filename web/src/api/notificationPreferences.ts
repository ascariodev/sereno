import { api } from './client'
import type { NotificationEmailType, NotificationPreferences } from './types'

export const NOTIFICATION_EMAIL_TYPES: readonly NotificationEmailType[] = [
  'task_assigned',
  'task_comment_mention',
  'task_commented',
  'chat_mention',
]

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  return (await api.get<{ data: NotificationPreferences }>('/api/me/notification-preferences')).data
}

export async function updateNotificationPreferences(email: Partial<Record<NotificationEmailType, boolean>>): Promise<NotificationPreferences> {
  return (await api.patch<{ data: NotificationPreferences }>('/api/me/notification-preferences', { email })).data
}
