import type { RouteLocationRaw } from 'vue-router'
import type { AppNotification } from './api/types'

export function notificationTarget(notification: AppNotification): RouteLocationRaw | null {
  switch (notification.type) {
    case 'task_assigned':
    case 'task_comment_mention':
    case 'task_commented':
      if (notification.project_id === null) return null
      return {
        name: 'project-plan',
        params: { projectId: notification.project_id },
        query: { task: String(notification.data.task_id) },
      }
    case 'chat_mention':
      return {
        name: 'channel',
        params: { id: notification.data.channel_id },
        query:
          notification.data.parent_id === null
            ? { message: String(notification.data.message_id) }
            : { thread: String(notification.data.parent_id) },
      }
    default:
      return null
  }
}
