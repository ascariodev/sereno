export type LogGroupStatus = 'open' | 'resolved' | 'ignored'

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

export interface TaskCreatedFromGroupPayload {
  type: 'task.created_from_group'
  log_group_id: number
  task_id: number
  task_key: string
  task_status: string
}

export interface TaskGroupReopenedPayload {
  type: 'task.group_reopened'
  log_group_id: number
  task_id: number
  task_key: string
}

export interface UnknownPayload {
  type: string
  [key: string]: unknown
}

export type MessagePayload =
  | LogGroupOpenedPayload
  | LogGroupStatusChangedPayload
  | TaskCreatedFromGroupPayload
  | TaskGroupReopenedPayload
  | UnknownPayload

const LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']

export function levelTone(level: string | null | undefined): string {
  return level && LEVELS.includes(level) ? level : 'debug'
}

export function isLogGroupStatus(value: unknown): value is LogGroupStatus {
  return value === 'open' || value === 'resolved' || value === 'ignored'
}

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

export function isTaskCreatedFromGroupPayload(payload: MessagePayload | null): payload is TaskCreatedFromGroupPayload {
  return (
    payload?.type === 'task.created_from_group' &&
    typeof payload.log_group_id === 'number' &&
    typeof payload.task_id === 'number' &&
    typeof payload.task_key === 'string' &&
    typeof payload.task_status === 'string'
  )
}

export function isTaskGroupReopenedPayload(payload: MessagePayload | null): payload is TaskGroupReopenedPayload {
  return (
    payload?.type === 'task.group_reopened' &&
    typeof payload.log_group_id === 'number' &&
    typeof payload.task_id === 'number' &&
    typeof payload.task_key === 'string'
  )
}
