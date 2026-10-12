import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { TaskComment } from '../api/types'
import { useTaskCommentsStore } from './taskComments'

const comment = (id: number, overrides: Partial<TaskComment> = {}): TaskComment => ({
  id,
  task_id: 9,
  body: `c${id}`,
  user: { id: 1, name: 'Ana' },
  mentions: [],
  attachments: [],
  created_at: '2026-10-12T10:00:00.000000Z',
  edited_at: null,
  ...overrides,
})
const page = (data: TaskComment[], nextCursor: string | null = null) => ({ data, meta: { next_cursor: nextCursor } }) as never
const ids = (list: readonly TaskComment[]) => list.map((item) => item.id)

function deferred(): { promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void } {
  let resolve: (value: unknown) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function opened(data: TaskComment[], nextCursor: string | null = null) {
  vi.spyOn(api, 'get').mockResolvedValueOnce(page(data, nextCursor))
  const store = useTaskCommentsStore()
  await store.open(3, 9)
  return store
}

describe('task comments store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    useTaskCommentsStore().clear()
  })

  it('loads the newest page and shows it oldest first', async () => {
    const store = await opened([comment(3), comment(2), comment(1)], 'next')

    expect(ids(store.comments)).toEqual([1, 2, 3])
    expect(store.nextCursor).toBe('next')
    expect(store.loading).toBe(false)
  })

  it('reports a failed first load and keeps the list empty', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(500, 'boom'))
    const store = useTaskCommentsStore()

    await store.open(3, 9)

    expect(store.error?.status).toBe(500)
    expect(store.comments).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('pages towards older comments with the cursor', async () => {
    const store = await opened([comment(5), comment(4)], 'c1')
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([comment(3), comment(2)], null))

    await store.loadOlder()

    expect(get.mock.calls[1][1]?.query).toMatchObject({ cursor: 'c1' })
    expect(ids(store.comments)).toEqual([2, 3, 4, 5])
    expect(store.nextCursor).toBeNull()
    await store.loadOlder()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('does not request two older pages at once', async () => {
    const store = await opened([comment(5)], 'c1')
    const pending = deferred()
    const get = vi.spyOn(api, 'get').mockReturnValueOnce(pending.promise as never)

    const first = store.loadOlder()
    await store.loadOlder()
    pending.resolve(page([comment(4)]))
    await first

    expect(get).toHaveBeenCalledTimes(2)
  })

  it('drops the first load when another task opens meanwhile', async () => {
    const slow = deferred()
    const get = vi.spyOn(api, 'get')
    get.mockReturnValueOnce(slow.promise as never)
    const store = useTaskCommentsStore()
    const first = store.open(3, 9)
    get.mockResolvedValueOnce(page([comment(20, { task_id: 10 })]))
    await store.open(3, 10)

    slow.resolve(page([comment(1)]))
    await first

    expect(ids(store.comments)).toEqual([20])
    expect(store.taskId).toBe(10)
    expect(store.loading).toBe(false)
  })

  it('drops a pending load after clear', async () => {
    const slow = deferred()
    vi.spyOn(api, 'get').mockReturnValueOnce(slow.promise as never)
    const store = useTaskCommentsStore()
    const loading = store.open(3, 9)

    store.clear()
    slow.resolve(page([comment(1)]))
    await loading

    expect(store.comments).toEqual([])
    expect(store.taskId).toBeNull()
  })

  it('drops a failure that arrives after clear', async () => {
    const slow = deferred()
    vi.spyOn(api, 'get').mockReturnValueOnce(slow.promise as never)
    const store = useTaskCommentsStore()
    const loading = store.open(3, 9)

    store.clear()
    slow.reject(new ApiError(500, 'boom'))
    await loading

    expect(store.error).toBeNull()
  })

  it('adds a live comment of the open task once, even after the POST response brought it', async () => {
    const store = await opened([comment(1)])
    vi.spyOn(api, 'post').mockResolvedValueOnce({ data: comment(2) } as never)

    await store.send('c2')
    expect(store.insert(comment(2))).toBe(false)
    expect(store.insert(comment(3))).toBe(true)
    expect(store.insert(comment(3))).toBe(false)

    expect(ids(store.comments)).toEqual([1, 2, 3])
  })

  it('takes the POST response when the live comment arrived first, without duplicating', async () => {
    const store = await opened([comment(1)])
    const pending = deferred()
    vi.spyOn(api, 'post').mockReturnValueOnce(pending.promise as never)

    const sending = store.send('c2')
    store.insert(comment(2))
    pending.resolve({ data: comment(2) })
    await sending

    expect(ids(store.comments)).toEqual([1, 2])
  })

  it('ignores a live comment of another task or with no task open', async () => {
    const store = useTaskCommentsStore()
    expect(store.insert(comment(1))).toBe(false)
    await opened([comment(1)])

    expect(store.insert(comment(2, { task_id: 10 }))).toBe(false)
    expect(ids(store.comments)).toEqual([1])
  })

  it('keeps a live comment that arrives while the first page is loading', async () => {
    const slow = deferred()
    vi.spyOn(api, 'get').mockReturnValueOnce(slow.promise as never)
    const store = useTaskCommentsStore()
    const loading = store.open(3, 9)

    expect(store.insert(comment(4))).toBe(true)
    slow.resolve(page([comment(3), comment(2)], 'next'))
    await loading

    expect(ids(store.comments)).toEqual([2, 3, 4])
    expect(store.nextCursor).toBe('next')
  })

  it('does not duplicate a live comment that the first page also carries', async () => {
    const slow = deferred()
    vi.spyOn(api, 'get').mockReturnValueOnce(slow.promise as never)
    const store = useTaskCommentsStore()
    const loading = store.open(3, 9)

    store.insert(comment(3))
    slow.resolve(page([comment(3), comment(2)]))
    await loading

    expect(ids(store.comments)).toEqual([2, 3])
  })

  it('drops the POST response when the store was cleared meanwhile', async () => {
    const store = await opened([comment(1)])
    const pending = deferred()
    vi.spyOn(api, 'post').mockReturnValueOnce(pending.promise as never)

    const sending = store.send('hi')
    store.clear()
    await opened([comment(50, { task_id: 10 })])
    pending.resolve({ data: comment(2, { task_id: 10 }) })
    await sending

    expect(ids(store.comments)).toEqual([50])
  })

  it('sends the attachment ids and lets API errors reach the composer', async () => {
    const store = await opened([])
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce({ data: comment(1) } as never)
    await store.send('hi', [4])
    expect(post.mock.calls[0][1]).toEqual({ body: 'hi', attachment_ids: [4] })

    post.mockRejectedValueOnce(new ApiError(422, 'bad'))
    await expect(store.send('x')).rejects.toMatchObject({ status: 422 })
    expect(ids(store.comments)).toEqual([1])
  })

  it('drops an older page requested before the list was replaced by a refresh', async () => {
    const store = await opened([comment(5), comment(4)], 'old')
    const olderPage = deferred()
    const get = vi.spyOn(api, 'get')
    get.mockReturnValueOnce(olderPage.promise as never)
    const older = store.loadOlder()
    expect(store.loadingMore).toBe(true)

    get.mockResolvedValueOnce(page([comment(40), comment(39)], 'fresh'))
    await store.refresh()
    olderPage.resolve(page([comment(3), comment(2)], null))
    await older

    expect(ids(store.comments)).toEqual([39, 40])
    expect(store.nextCursor).toBe('fresh')
    expect(store.loadingMore).toBe(false)
  })

  it('merges a refresh that reaches the loaded comments without touching the older cursor', async () => {
    const store = await opened([comment(5), comment(4)], 'old')
    vi.spyOn(api, 'get').mockResolvedValueOnce(page([comment(7), comment(6), comment(5)], 'newer'))

    await store.refresh()

    expect(ids(store.comments)).toEqual([4, 5, 6, 7])
    expect(store.nextCursor).toBe('old')
  })

  it('keeps a live comment that arrived while a replacing refresh was in flight', async () => {
    const store = await opened([comment(5)], 'old')
    const fresh = deferred()
    vi.spyOn(api, 'get').mockReturnValueOnce(fresh.promise as never)

    const refreshing = store.refresh()
    await Promise.resolve()
    store.insert(comment(50))
    fresh.resolve(page([comment(40), comment(39)], 'fresh'))
    await refreshing

    expect(ids(store.comments)).toEqual([39, 40, 50])
  })

  it('ignores a refresh failure and one that lands after clear', async () => {
    const store = await opened([comment(1)])
    vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(500, 'boom'))
    await store.refresh()
    expect(ids(store.comments)).toEqual([1])
    expect(store.error).toBeNull()

    const fresh = deferred()
    vi.spyOn(api, 'get').mockReturnValueOnce(fresh.promise as never)
    const refreshing = store.refresh()
    await Promise.resolve()
    store.clear()
    fresh.resolve(page([comment(9)]))
    await refreshing
    expect(store.comments).toEqual([])
  })

  it('update replaces a known comment of the open task and ignores others', async () => {
    const store = await opened([comment(1), comment(2)])
    expect(store.update(comment(2, { body: 'edited', edited_at: '2026-10-12T11:00:00.000000Z' }))).toBe(true)
    expect(store.comments[1].body).toBe('edited')
    expect(store.update(comment(7, { body: 'x' }))).toBe(false)
    expect(store.update(comment(1, { task_id: 99, body: 'x' }))).toBe(false)
    expect(ids(store.comments)).toEqual([1, 2])
    expect(store.comments[0].body).toBe('c1')
  })

  it('update drops an edit older than the known one', async () => {
    const store = await opened([comment(1, { body: 'new', edited_at: '2026-10-12T12:00:00.000000Z' })])
    expect(store.update(comment(1, { body: 'old', edited_at: '2026-10-12T11:00:00.000000Z' }))).toBe(false)
    expect(store.update(comment(1, { body: 'unedited', edited_at: null }))).toBe(false)
    expect(store.comments[0].body).toBe('new')
  })

  it('remove drops a known comment by id', async () => {
    const store = await opened([comment(1), comment(2)])
    expect(store.remove(1)).toBe(true)
    expect(store.remove(1)).toBe(false)
    expect(ids(store.comments)).toEqual([2])
  })
})
