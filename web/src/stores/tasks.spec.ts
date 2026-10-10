import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { Task, TaskStatus } from '../api/types'
import { useAuthStore } from './auth'
import { MAX_TOMBSTONES, updatedStamp, useTasksStore } from './tasks'

const task = (id: number, overrides: Partial<Task> = {}): Task => ({
  id,
  project_id: 7,
  key: `POSVE-${id}`,
  number: id,
  title: `t${id}`,
  description: null,
  status: 'todo',
  position: id,
  created_by: 1,
  assignee: null,
  log_group: null,
  created_at: '2026-10-10T00:00:00.000000Z',
  updated_at: '2026-10-10T00:00:00.000000Z',
  ...overrides,
})
const envelope = (data: unknown) => ({ data }) as never
const ids = (list: readonly Task[]) => list.map((item) => item.id)

function deferred(): { promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void } {
  let resolve: (value: unknown) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function opened(list: Task[]): Promise<ReturnType<typeof useTasksStore>> {
  vi.spyOn(api, 'get').mockResolvedValueOnce(envelope(list))
  const store = useTasksStore()
  await store.open(7)
  return store
}

describe('tasks store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    useTasksStore().clear()
  })

  it('loads a project and orders each column by position, then id', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(
      envelope([
        task(1, { position: 2 }),
        task(2, { position: 1 }),
        task(3, { position: 1 }),
        task(4, { status: 'done', position: -1 }),
        task(5, { status: 'done', position: 0.5 }),
      ]),
    )
    const store = useTasksStore()
    expect(await store.open(7)).toBe(true)
    expect(get).toHaveBeenCalledWith('/api/projects/7/tasks', { signal: expect.any(AbortSignal) })
    expect(store.projectId).toBe(7)
    expect(store.loading).toBe(false)
    expect(ids(store.columns.todo)).toEqual([2, 3, 1])
    expect(ids(store.columns.done)).toEqual([4, 5])
    expect(store.columns.in_progress).toEqual([])
    expect(store.columns.in_review).toEqual([])
  })

  it('discards a load that finishes after clear()', async () => {
    const pending = deferred()
    vi.spyOn(api, 'get').mockReturnValue(pending.promise as never)
    const store = useTasksStore()
    const result = store.open(7)
    store.clear()
    pending.resolve(envelope([task(1)]))
    expect(await result).toBe(false)
    expect(store.tasks).toEqual([])
    expect(store.projectId).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('discards the load of the previous project when another one opens', async () => {
    const first = deferred()
    vi.spyOn(api, 'get')
      .mockReturnValueOnce(first.promise as never)
      .mockResolvedValueOnce(envelope([task(9, { project_id: 8 })]))
    const store = useTasksStore()
    const old = store.open(7)
    await store.open(8)
    first.resolve(envelope([task(1)]))
    expect(await old).toBe(false)
    expect(ids(store.tasks)).toEqual([9])
  })

  it('keeps the error of a failed open', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(403, 'no'))
    const store = useTasksStore()
    expect(await store.open(7)).toBe(false)
    expect(store.error?.status).toBe(403)
    expect(store.loading).toBe(false)
  })

  it('keeps the list and sets no error when a refresh fails', async () => {
    const store = await opened([task(1)])
    vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(500, 'down'))
    expect(await store.refresh()).toBe(false)
    expect(ids(store.tasks)).toEqual([1])
    expect(store.error).toBeNull()
  })

  it('a refresh drops what was deleted and keeps what arrived in live while it loaded', async () => {
    const store = await opened([task(1), task(2)])
    const pending = deferred()
    vi.spyOn(api, 'get').mockReturnValueOnce(pending.promise as never)
    const result = store.refresh()
    store.insert(task(3))
    store.replace(task(1, { title: 'live', updated_at: '2026-10-10T00:00:02.000000Z' }))
    pending.resolve(envelope([task(1, { title: 'snapshot', updated_at: '2026-10-10T00:00:01.000000Z' })]))
    expect(await result).toBe(true)
    expect(ids(store.columns.todo)).toEqual([1, 3])
    expect(store.find(1)?.title).toBe('live')
  })

  it('a refresh replaced by a newer one waits for it', async () => {
    const store = await opened([task(1)])
    const first = deferred()
    const second = deferred()
    vi.spyOn(api, 'get')
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never)
    const older = store.refresh()
    const newer = store.refresh()
    first.resolve(envelope([task(1)]))
    let settled = false
    void older.then(() => (settled = true))
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    second.resolve(envelope([task(1), task(2)]))
    expect(await older).toBe(true)
    expect(await newer).toBe(true)
    expect(ids(store.tasks)).toEqual([1, 2])
  })

  it('insert is idempotent with the own create response', async () => {
    const store = await opened([])
    const created = task(4)
    vi.spyOn(api, 'post').mockResolvedValue(envelope(created))
    expect(await store.create(7, { title: 't4' })).toEqual(created)
    expect(store.insert(created)).toBe(true)
    expect(ids(store.tasks)).toEqual([4])
  })

  it('does not overwrite a newer version with an older event, comparing microseconds', async () => {
    const store = await opened([task(1, { title: 'new', updated_at: '2026-10-10T00:00:00.000502Z' })])
    expect(store.replace(task(1, { title: 'old', updated_at: '2026-10-10T00:00:00.000501Z' }))).toBe(false)
    expect(store.find(1)?.title).toBe('new')
    expect(store.replace(task(1, { title: 'newer', updated_at: '2026-10-10T00:00:00.000503Z' }))).toBe(true)
    expect(store.find(1)?.title).toBe('newer')
  })

  it('compares updated_at with microsecond precision', () => {
    expect(updatedStamp('2026-10-10T00:00:00.000502Z') - updatedStamp('2026-10-10T00:00:00.000501Z')).toBe(1)
    expect(updatedStamp('2026-10-10T00:00:01Z') - updatedStamp('2026-10-10T00:00:00.999999Z')).toBe(1)
  })

  it.each(['response first', 'event first'])('applies a move once when its response and task.updated both arrive (%s)', async (order) => {
    const store = await opened([task(1), task(2, { status: 'done', position: 1 })])
    const moved = task(1, { status: 'done', position: 0, updated_at: '2026-10-10T00:00:05.000000Z' })
    vi.spyOn(api, 'post').mockResolvedValue(envelope(moved))
    if (order === 'event first') store.replace(moved)
    await store.move(7, 1, { status: 'done', beforeId: 2 })
    if (order === 'response first') store.replace(moved)
    expect(store.columns.todo).toEqual([])
    expect(ids(store.columns.done)).toEqual([1, 2])
  })

  it('an own response older than an event already applied does not revert it', async () => {
    const store = await opened([task(1)])
    const pending = deferred()
    vi.spyOn(api, 'post').mockReturnValue(pending.promise as never)
    const result = store.move(7, 1, { status: 'in_progress' })
    store.replace(task(1, { status: 'in_review', updated_at: '2026-10-10T00:00:09.000000Z' }))
    pending.resolve(envelope(task(1, { status: 'in_progress', updated_at: '2026-10-10T00:00:08.000000Z' })))
    expect((await result).status).toBe('in_progress')
    expect(store.find(1)?.status).toBe('in_review')
  })

  it('a deleted task does not come back with a late event or load', async () => {
    const store = await opened([task(1), task(2)])
    expect(store.remove({ id: 1, project_id: 7 })).toBe(true)
    expect(store.remove({ id: 1, project_id: 7 })).toBe(false)
    expect(store.replace(task(1, { updated_at: '2026-10-10T00:00:09.000000Z' }))).toBe(false)
    expect(store.insert(task(1))).toBe(false)
    vi.spyOn(api, 'get').mockResolvedValueOnce(envelope([task(1), task(2)]))
    await store.refresh()
    expect(ids(store.tasks)).toEqual([2])
  })

  it('ignores events of another project or with an unknown status', async () => {
    const store = await opened([task(1)])
    expect(store.insert(task(2, { project_id: 8 }))).toBe(false)
    expect(store.insert(task(3, { status: 'blocked' as TaskStatus }))).toBe(false)
    expect(store.remove({ id: 1, project_id: 8 })).toBe(false)
    expect(ids(store.tasks)).toEqual([1])
  })

  it('replace adds a task whose created event was missed', async () => {
    const store = await opened([])
    expect(store.replace(task(5))).toBe(true)
    expect(ids(store.tasks)).toEqual([5])
  })

  it('does not apply an own response after clear() or for another project, but returns it', async () => {
    const store = await opened([])
    const pending = deferred()
    vi.spyOn(api, 'post').mockReturnValueOnce(pending.promise as never).mockResolvedValueOnce(envelope(task(6, { project_id: 8 })))
    const result = store.create(7, { title: 't5' })
    store.clear()
    vi.spyOn(api, 'get').mockResolvedValueOnce(envelope([]))
    await store.open(7)
    pending.resolve(envelope(task(5)))
    expect((await result).id).toBe(5)
    expect((await store.create(8, { title: 't6' })).id).toBe(6)
    expect(store.tasks).toEqual([])
  })

  it('edits a task with the server response', async () => {
    const store = await opened([task(1)])
    const patch = vi
      .spyOn(api, 'patch')
      .mockResolvedValue(envelope(task(1, { title: 'edited', updated_at: '2026-10-10T00:00:03.000000Z' })))
    await store.update(7, 1, { title: 'edited' })
    expect(patch).toHaveBeenCalledWith('/api/projects/7/tasks/1', { title: 'edited' })
    expect(store.find(1)?.title).toBe('edited')
  })

  it('removes a task after deleting it and leaves it when the delete fails', async () => {
    const store = await opened([task(1), task(2)])
    vi.spyOn(api, 'delete').mockRejectedValueOnce(new ApiError(403, 'no')).mockResolvedValueOnce(undefined as never)
    await expect(store.destroy(7, 1)).rejects.toBeInstanceOf(ApiError)
    expect(ids(store.tasks)).toEqual([1, 2])
    await store.destroy(7, 1)
    expect(ids(store.tasks)).toEqual([2])
  })

  it('filters by Mine with the current user and by From notices', async () => {
    const store = await opened([
      task(1, { assignee: { id: 3, name: 'Ana' } }),
      task(2, { assignee: { id: 4, name: 'Luis' } }),
      task(3, { log_group: { id: 9, level: 'error', title: 'boom', status: 'open', events_count: 2 } }),
    ])
    expect(ids(store.visibleColumns.todo)).toEqual([1, 2, 3])
    store.filter = 'mine'
    expect(store.visibleColumns.todo).toEqual([])
    useAuthStore().user = { id: 3, name: 'Ana', email: 'ana@example.com', locale: null }
    expect(ids(store.visibleColumns.todo)).toEqual([1])
    store.filter = 'from_notices'
    expect(ids(store.visibleColumns.todo)).toEqual([3])
    expect(ids(store.columns.todo)).toEqual([1, 2, 3])
  })
  it('sets the error when a refresh that replaced the first load fails', async () => {
    const first = deferred()
    vi.spyOn(api, 'get')
      .mockReturnValueOnce(first.promise as never)
      .mockRejectedValueOnce(new ApiError(500, 'down'))
    const store = useTasksStore()
    const opening = store.open(7)
    const refreshing = store.refresh()
    first.resolve(envelope([task(1)]))
    expect(await refreshing).toBe(false)
    expect(await opening).toBe(false)
    expect(store.error?.status).toBe(500)
    expect(store.loading).toBe(false)
  })

  it('opening the project already open only reloads it and keeps the own actions in flight', async () => {
    const store = await opened([task(1)])
    const pending = deferred()
    vi.spyOn(api, 'post').mockReturnValueOnce(pending.promise as never)
    const result = store.create(7, { title: 't2' })
    vi.spyOn(api, 'get').mockResolvedValueOnce(envelope([task(1)]))
    expect(await store.open(7)).toBe(true)
    expect(store.loading).toBe(false)
    pending.resolve(envelope(task(2)))
    await result
    expect(ids(store.columns.todo)).toEqual([1, 2])
  })

  it('applies an own create response that arrives while a refresh loads (L-14)', async () => {
    const store = await opened([task(1)])
    const created = deferred()
    const reloaded = deferred()
    vi.spyOn(api, 'post').mockReturnValueOnce(created.promise as never)
    vi.spyOn(api, 'get').mockReturnValueOnce(reloaded.promise as never)
    const creating = store.create(7, { title: 't2' })
    const refreshing = store.refresh()
    created.resolve(envelope(task(2)))
    await creating
    reloaded.resolve(envelope([task(1)]))
    expect(await refreshing).toBe(true)
    expect(ids(store.columns.todo)).toEqual([1, 2])
  })

  it('discards a refresh that finishes after clear()', async () => {
    const store = await opened([task(1)])
    const pending = deferred()
    vi.spyOn(api, 'get').mockReturnValueOnce(pending.promise as never)
    const result = store.refresh()
    store.clear()
    pending.resolve(envelope([task(1), task(2)]))
    expect(await result).toBe(false)
    expect(store.tasks).toEqual([])
    expect(store.projectId).toBeNull()
  })

  it(`remembers up to ${MAX_TOMBSTONES} deleted ids, forgetting the oldest`, async () => {
    const store = await opened([])
    for (let id = 1; id <= MAX_TOMBSTONES + 1; id++) store.remove({ id, project_id: 7 })
    expect(store.insert(task(2))).toBe(false)
    expect(store.insert(task(1))).toBe(true)
  })

  it('on an updated_at tie the incoming version wins', async () => {
    const store = await opened([task(1, { position: 3 })])
    expect(store.replace(task(1, { position: 1 }))).toBe(true)
    expect(store.find(1)?.position).toBe(1)
  })
})
