import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTaskComment, listTaskComments } from './taskComments'
import type { TaskComment } from './types'

const comment: TaskComment = {
  id: 4,
  task_id: 9,
  body: 'Hi <@2>',
  user: { id: 1, name: 'Ana' },
  mentions: [{ id: 2, name: 'Bo' }],
  attachments: [],
  created_at: '2026-10-12T10:00:00.000000Z',
}

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('task comments api', () => {
  it('lists with cursor and page size and returns the page as is', async () => {
    const page = { data: [comment], meta: { next_cursor: 'n1' } }
    const fetchMock = stubFetch(page)

    const result = await listTaskComments(3, 9, { cursor: 'abc', perPage: 20 })

    const url = new URL(fetchMock.mock.calls[0][0], 'http://x')
    expect(url.pathname).toBe('/api/projects/3/tasks/9/comments')
    expect(url.searchParams.get('cursor')).toBe('abc')
    expect(url.searchParams.get('per_page')).toBe('20')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET')
    expect(result).toEqual(page)
  })

  it('omits cursor and page size when not given', async () => {
    const fetchMock = stubFetch({ data: [], meta: { next_cursor: null } })
    await listTaskComments(3, 9)
    expect(new URL(fetchMock.mock.calls[0][0], 'http://x').search).toBe('')
  })

  it('posts the body and unwraps the comment', async () => {
    const fetchMock = stubFetch({ data: comment }, 201)

    const result = await createTaskComment(3, 9, 'Hi <@2>')

    expect(new URL(fetchMock.mock.calls[0][0], 'http://x').pathname).toBe('/api/projects/3/tasks/9/comments')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ body: 'Hi <@2>' })
    expect(result).toEqual(comment)
  })

  it('sends attachment_ids only when there are attachments', async () => {
    const fetchMock = stubFetch({ data: comment }, 201)
    await createTaskComment(3, 9, 'x', [7, 8])
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ body: 'x', attachment_ids: [7, 8] })
  })
})
