import { api } from './client'
import type { NotificationChannel, NotificationPreferences, NotificationType } from './types'

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  'task_assigned',
  'task_comment_mention',
  'task_commented',
  'chat_mention',
]

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['email', 'push']

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  return (await api.get<{ data: NotificationPreferences }>('/api/me/notification-preferences')).data
}

export async function updateNotificationPreferences(
  channel: NotificationChannel,
  changes: Partial<Record<NotificationType, boolean>>,
): Promise<NotificationPreferences> {
  return (await api.patch<{ data: NotificationPreferences }>('/api/me/notification-preferences', { [channel]: changes })).data
}
