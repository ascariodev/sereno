import { api } from '@/api/client';

export const NOTIFICATION_TYPES = ['task_assigned', 'task_comment_mention', 'task_commented', 'chat_mention'] as const;
export const NOTIFICATION_CHANNELS = ['email', 'push'] as const;

export type PreferenceType = (typeof NOTIFICATION_TYPES)[number];
export type PreferenceChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationPreferences = Record<PreferenceChannel, Record<PreferenceType, boolean>>;

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  return (await api.get<{ data: NotificationPreferences }>('/api/me/notification-preferences')).data;
}

export async function updateNotificationPreferences(
  channel: PreferenceChannel,
  changes: Partial<Record<PreferenceType, boolean>>,
): Promise<NotificationPreferences> {
  return (
    await api.patch<{ data: NotificationPreferences }>('/api/me/notification-preferences', { [channel]: changes })
  ).data;
}
