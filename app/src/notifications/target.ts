import type { AppNotification } from './types'

export interface NotificationTarget {
  pathname: '/channel' | '/thread'
  params: Record<string, string>
}

export function notificationTarget(notification: AppNotification): NotificationTarget | null {
  if (notification.type !== 'chat_mention') return null
  const { channel_id: channelId, channel_name: channelName, parent_id: parentId } = notification.data
  if (parentId === null) return { pathname: '/channel', params: { id: String(channelId), name: channelName } }
  return { pathname: '/thread', params: { channelId: String(channelId), id: String(parentId) } }
}

export function isTaskNotification(notification: AppNotification): boolean {
  return (
    notification.type === 'task_assigned' ||
    notification.type === 'task_comment_mention' ||
    notification.type === 'task_commented'
  )
}
