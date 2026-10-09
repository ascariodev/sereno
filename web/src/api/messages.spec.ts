import { afterEach, describe, expect, it, vi } from 'vitest'
import { listReplies, sendReply } from './messages'

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('messages api', () => {
  it('lists the replies of a root with cursor and page size', async () => {
    const fetchMock = stubFetch({ data: [], meta: { next_cursor: null } })
    await listReplies(5, 9, { cursor: 'abc', perPage: 20 })
    const url = new URL(fetchMock.mock.calls[0][0], 'http://x')
    expect(url.pathname).toBe('/api/channels/5/messages/9/replies')
    expect(url.searchParams.get('cursor')).toBe('abc')
    expect(url.searchParams.get('per_page')).toBe('20')
  })

  it('omits the cursor on the first page', async () => {
    const fetchMock = stubFetch({ data: [], meta: { next_cursor: null } })
    await listReplies(5, 9)
    expect(new URL(fetchMock.mock.calls[0][0], 'http://x').searchParams.has('cursor')).toBe(false)
  })

  it('posts a reply with parent_id and unwraps the message', async () => {
    const fetchMock = stubFetch({ data: { id: 12, parent_id: 9 } }, 201)
    const reply = await sendReply(5, 9, 'hola')
    expect(reply).toEqual({ id: 12, parent_id: 9 })
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ body: 'hola', parent_id: 9 })
  })
})
