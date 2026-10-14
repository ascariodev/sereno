import type { TFunction } from 'i18next'

import type { AppNotification } from './types'

export function notificationTitle(notification: AppNotification, t: TFunction): string {
  switch (notification.type) {
    case 'task_assigned':
      return t('notifications.taskAssigned', { name: notification.data.actor_name, task: notification.data.task_key })
    case 'task_comment_mention':
      return t('notifications.taskCommentMention', { name: notification.data.actor_name, task: notification.data.task_key })
    case 'task_commented':
      return t('notifications.taskCommented', { name: notification.data.actor_name, task: notification.data.task_key })
    case 'chat_mention':
      return t('notifications.chatMention', { name: notification.data.actor_name, channel: notification.data.channel_name })
    default:
      return t('notifications.unknown')
  }
}

export function notificationBody(notification: AppNotification): string | null {
  switch (notification.type) {
    case 'task_assigned':
      return notification.data.task_title
    case 'task_comment_mention':
    case 'task_commented':
      return notification.data.comment_excerpt
    case 'chat_mention':
      return notification.data.message_excerpt
    default:
      return null
  }
}
