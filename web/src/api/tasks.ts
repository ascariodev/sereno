import { api } from './client'
import type { DataEnvelope, Task, TaskStatus } from './types'

export interface CreateTaskInput {
  title: string
  description?: string | null
  status?: TaskStatus
  assigneeId?: number | null
  logGroupId?: number | null
}

export interface UpdateTaskInput {
  title?: string
  description?: string | null
  assigneeId?: number | null
}

export interface MoveTaskInput {
  status: TaskStatus
  /** Task that stays right above the moved one. */
  afterId?: number | null
  /** Task that stays right below the moved one. */
  beforeId?: number | null
}

const base = (projectId: number) => `/api/projects/${projectId}/tasks`

/** All tasks of the project, ordered by column and position. */
export async function listTasks(projectId: number, signal?: AbortSignal): Promise<Task[]> {
  const response = await api.get<DataEnvelope<Task[]>>(base(projectId), { signal })
  return response.data
}

export async function createTask(projectId: number, input: CreateTaskInput): Promise<Task> {
  const response = await api.post<DataEnvelope<Task>>(base(projectId), {
    title: input.title,
    description: input.description,
    status: input.status,
    assignee_id: input.assigneeId,
    log_group_id: input.logGroupId,
  })
  return response.data
}

export async function updateTask(projectId: number, taskId: number, input: UpdateTaskInput): Promise<Task> {
  const body: Record<string, unknown> = {}
  if (input.title !== undefined) body.title = input.title
  if (input.description !== undefined) body.description = input.description
  if (input.assigneeId !== undefined) body.assignee_id = input.assigneeId
  const response = await api.patch<DataEnvelope<Task>>(`${base(projectId)}/${taskId}`, body)
  return response.data
}

export async function moveTask(projectId: number, taskId: number, input: MoveTaskInput): Promise<Task> {
  const response = await api.post<DataEnvelope<Task>>(`${base(projectId)}/${taskId}/move`, {
    status: input.status,
    after_id: input.afterId,
    before_id: input.beforeId,
  })
  return response.data
}

export async function deleteTask(projectId: number, taskId: number): Promise<void> {
  await api.delete<void>(`${base(projectId)}/${taskId}`)
}
