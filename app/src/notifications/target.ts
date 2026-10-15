import type { AppNotification } from './types'

export interface NotificationTarget {
  pathname: '/channel' | '/thread' | '/task'
  params: Record<string, string>
}

export function notificationTarget(notification: AppNotification): NotificationTarget | null {
  if (isTaskNotification(notification)) {
    if (notification.project_id === null || !('task_id' in notification.data)) return null
    return { pathname: '/task', params: { projectId: String(notification.project_id), id: String(notification.data.task_id) } }
  }
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
