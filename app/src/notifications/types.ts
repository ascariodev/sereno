interface NotificationBase {
  id: number
  project_id: number | null
  read_at: string | null
  created_at: string
}

interface TaskData {
  task_id: number
  task_key: string
  task_title: string
  actor_id: number
  actor_name: string
}

interface TaskCommentData extends TaskData {
  comment_id: number
  comment_excerpt: string
}

interface ChatMentionData {
  channel_id: number
  channel_name: string
  message_id: number
  parent_id: number | null
  message_excerpt: string
  actor_id: number
  actor_name: string
}

export type AppNotification =
  | (NotificationBase & { type: 'task_assigned'; data: TaskData })
  | (NotificationBase & { type: 'task_comment_mention'; data: TaskCommentData })
  | (NotificationBase & { type: 'task_commented'; data: TaskCommentData })
  | (NotificationBase & { type: 'chat_mention'; data: ChatMentionData })
  | (NotificationBase & { type: 'unknown'; original_type: string; data: Record<string, unknown> })

export interface NotificationPage {
  data: AppNotification[]
  meta: { next_cursor: string | null; unread_count: number }
}
