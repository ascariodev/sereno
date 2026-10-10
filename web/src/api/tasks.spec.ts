import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTask, deleteTask, listTasks, moveTask, updateTask } from './tasks'
import { isTaskStatus } from './types'
import type { Task } from './types'

const task: Task = {
  id: 5,
  project_id: 3,
  key: 'POSVE-14',
  number: 14,
  title: 'Fix timeout',
  description: null,
  status: 'todo',
  position: -0.5,
  created_by: 1,
  assignee: null,
  log_group: null,
  created_at: '2026-10-10T00:41:21.927755Z',
  updated_at: '2026-10-10T00:41:21.927755Z',
}

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const sentBody = (fetchMock: ReturnType<typeof stubFetch>) => JSON.parse(String(fetchMock.mock.calls[0][1]?.body))

afterEach(() => vi.unstubAllGlobals())

describe('tasks client', () => {
  it('lists and unwraps the tasks of a project', async () => {
    const fetchMock = stubFetch({ data: [task] })

    const result = await listTasks(3)

    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/api/projects/3/tasks')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET')
    expect(result).toEqual([task])
  })

  it('creates with snake_case fields and unwraps the task', async () => {
    const fetchMock = stubFetch({ data: task }, 201)

    const result = await createTask(3, { title: 'Fix timeout', status: 'in_review', assigneeId: 2, logGroupId: 7 })

    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    expect(sentBody(fetchMock)).toEqual({ title: 'Fix timeout', status: 'in_review', assignee_id: 2, log_group_id: 7 })
    expect(result.key).toBe('POSVE-14')
  })

  it('sends only the fields to edit, allowing null to unassign', async () => {
    const fetchMock = stubFetch({ data: task })

    await updateTask(3, 5, { assigneeId: null })

    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/api/projects/3/tasks/5')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PATCH')
    expect(sentBody(fetchMock)).toEqual({ assignee_id: null })
  })

  it('moves with the neighbors', async () => {
    const fetchMock = stubFetch({ data: { ...task, status: 'done' } })

    const result = await moveTask(3, 5, { status: 'done', afterId: 8, beforeId: 9 })

    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/api/projects/3/tasks/5/move')
    expect(sentBody(fetchMock)).toEqual({ status: 'done', after_id: 8, before_id: 9 })
    expect(result.status).toBe('done')
  })

  it('deletes and resolves on 204', async () => {
    const fetchMock = stubFetch(null, 204)

    await expect(deleteTask(3, 5)).resolves.toBeUndefined()

    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
  })

  it('rejects with the 422 the API returns', async () => {
    stubFetch({ message: 'invalid', errors: { title: ['required'] } }, 422)

    await expect(createTask(3, { title: '' })).rejects.toMatchObject({ status: 422 })
  })
})

describe('isTaskStatus', () => {
  it('accepts the four statuses and rejects anything else', () => {
    expect(['todo', 'in_progress', 'in_review', 'done'].every(isTaskStatus)).toBe(true)
    expect(isTaskStatus('open')).toBe(false)
    expect(isTaskStatus(undefined)).toBe(false)
  })
})
