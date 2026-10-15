import { create } from 'zustand'

import { api } from '@/api/client'
import {
  isLogGroupStatus,
  isLogGroupStatusChangedPayload,
  isTaskCreatedFromGroupPayload,
  type LogGroupStatus,
} from './payload'
import { type Message, useMessagesStore } from './store'

export interface LogGroupTask {
  id: number
  key: string
  status: string
}

interface LogGroup {
  id: number
  status?: string
  task?: LogGroupTask | null
}

export interface TaskInput {
  title: string
  description: string | null
  logGroupId: number
  assigneeId?: number | null
}

interface LogGroupsState {
  statuses: Record<number, LogGroupStatus>
  tasks: Record<number, LogGroupTask>
}

export const useLogGroupsStore = create<LogGroupsState>()(() => ({ statuses: {}, tasks: {} }))

const lastMessageId = new Map<number, number>()
const observed = new Set<number>()
let highestSeenId = 0

export function setGroupStatus(groupId: number, status: LogGroupStatus): void {
  useLogGroupsStore.setState((state) => ({ statuses: { ...state.statuses, [groupId]: status } }))
  lastMessageId.set(groupId, highestSeenId)
}

export function setGroupTask(groupId: number, task: LogGroupTask): void {
  useLogGroupsStore.setState((state) => ({ tasks: { ...state.tasks, [groupId]: task } }))
}

export function forgetGroupTask(taskId: number): void {
  useLogGroupsStore.setState((state) => ({
    tasks: Object.fromEntries(Object.entries(state.tasks).filter(([, task]) => task.id !== taskId)),
  }))
}

export function observeStatusMessage(message: Message): void {
  highestSeenId = Math.max(highestSeenId, message.id)
  const payload = message.payload
  if (isTaskCreatedFromGroupPayload(payload)) {
    setGroupTask(payload.log_group_id, { id: payload.task_id, key: payload.task_key, status: payload.task_status })
    return
  }
  if (!isLogGroupStatusChangedPayload(payload) || !isLogGroupStatus(payload.status)) return
  if ((lastMessageId.get(payload.log_group_id) ?? 0) >= message.id) return
  lastMessageId.set(payload.log_group_id, message.id)
  const status = payload.status
  useLogGroupsStore.setState((state) => ({ statuses: { ...state.statuses, [payload.log_group_id]: status } }))
}

export function resetLogGroups(): void {
  lastMessageId.clear()
  observed.clear()
  highestSeenId = 0
  useLogGroupsStore.setState({ statuses: {}, tasks: {} })
}

// Status messages arrive through every path of the messages store (pages, live, catch-up),
// so the shared state follows the store instead of hooking each one.
useMessagesStore.subscribe((state, previous) => {
  if (state.channelId !== previous.channelId) resetLogGroups()
  if (state.messages === previous.messages) return
  const fresh = state.messages.filter((message) => message.kind === 'system' && !observed.has(message.id))
  for (const message of [...fresh].sort((a, b) => a.id - b.id)) {
    observed.add(message.id)
    observeStatusMessage(message)
  }
})

export async function updateLogGroupStatus(
  projectId: number,
  groupId: number,
  status: LogGroupStatus,
): Promise<LogGroupStatus> {
  const response = await api.patch<{ data: LogGroup }>(`/api/projects/${projectId}/log-groups/${groupId}`, { status })
  return isLogGroupStatus(response.data?.status) ? response.data.status : status
}

export async function getLogGroupTask(projectId: number, groupId: number): Promise<LogGroupTask | null> {
  const response = await api.get<{ data: LogGroup }>(`/api/projects/${projectId}/log-groups/${groupId}`)
  return response.data.task ?? null
}

export async function createTaskFromGroup(projectId: number, input: TaskInput): Promise<LogGroupTask> {
  const response = await api.post<{ data: LogGroupTask }>(`/api/projects/${projectId}/tasks`, {
    title: input.title,
    description: input.description,
    status: 'todo',
    log_group_id: input.logGroupId,
    ...(input.assigneeId != null ? { assignee_id: input.assigneeId } : {}),
  })
  const { id, key, status } = response.data
  return { id, key, status }
}
