import { reactive } from 'vue'
import { isLogGroupStatusChangedPayload } from '../api/types'
import type { LogGroupStatus, LogGroupTask, Message } from '../api/types'

const statuses = reactive(new Map<number, LogGroupStatus>())
const tasks = reactive(new Map<number, LogGroupTask>())
const lastMessageId = new Map<number, number>()
let highestSeenId = 0

export function setGroupStatus(groupId: number, status: LogGroupStatus): void {
  statuses.set(groupId, status)
  lastMessageId.set(groupId, highestSeenId)
}

export function observeStatusMessage(message: Message): void {
  highestSeenId = Math.max(highestSeenId, message.id)
  const payload = message.payload
  if (!isLogGroupStatusChangedPayload(payload)) return
  if ((lastMessageId.get(payload.log_group_id) ?? 0) >= message.id) return
  lastMessageId.set(payload.log_group_id, message.id)
  statuses.set(payload.log_group_id, payload.status)
}

export function resetGroupStatuses(): void {
  statuses.clear()
  tasks.clear()
  lastMessageId.clear()
  highestSeenId = 0
}

export function statusOfGroup(groupId: number | null): LogGroupStatus | undefined {
  return groupId === null ? undefined : statuses.get(groupId)
}

export function setGroupTask(groupId: number, task: LogGroupTask): void {
  tasks.set(groupId, task)
}

export function taskOfGroup(groupId: number | null): LogGroupTask | undefined {
  return groupId === null ? undefined : tasks.get(groupId)
}
