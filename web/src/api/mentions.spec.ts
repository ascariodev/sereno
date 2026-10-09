import { afterEach, describe, expect, it, vi } from 'vitest'
import { listMentions, markMentionsRead } from './mentions'

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('mentions api', () => {
  it('lists with cursor and page size, omitting an absent cursor', async () => {
    const fetchMock = stubFetch({ data: [], meta: { next_cursor: null, unread_count: 0 } })
    await listMentions({ cursor: 'abc', perPage: 20 })
    await listMentions()
    const first = new URL(fetchMock.mock.calls[0][0], 'http://x')
    expect(first.pathname).toBe('/api/mentions')
    expect(first.searchParams.get('cursor')).toBe('abc')
    expect(first.searchParams.get('per_page')).toBe('20')
    expect(new URL(fetchMock.mock.calls[1][0], 'http://x').searchParams.has('cursor')).toBe(false)
  })

  it('marks ids or all as read and returns the unread count', async () => {
    const fetchMock = stubFetch({ unread_count: 2 })
    expect(await markMentionsRead({ ids: [1, 2] })).toBe(2)
    await markMentionsRead({ all: true })
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ ids: [1, 2] })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ all: true })
  })
})
