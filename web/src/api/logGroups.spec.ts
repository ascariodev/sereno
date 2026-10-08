import { afterEach, describe, expect, it, vi } from 'vitest'
import { getHourlyCounts, getLogGroup, listLogGroups, statusFrom } from './logGroups'
import type { LogGroup } from './types'

const group: LogGroup = {
  id: 7,
  project_id: 3,
  level: 'error',
  title: 'Timeout',
  status: 'open',
  events_count: 2,
  first_seen_at: '2026-10-01T10:00:00.000000Z',
  last_seen_at: '2026-10-02T10:00:00.000000Z',
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

describe('log groups client', () => {
  it('lists with filters and pagination in the query string', async () => {
    const page = { data: [group], links: {}, meta: { current_page: 2, last_page: 3, per_page: 10, total: 25 } }
    const fetchMock = stubFetch(page)

    const result = await listLogGroups(3, { status: 'open', level: 'warning', page: 2, perPage: 10 })

    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/api/projects/3/log-groups')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'open',
      level: 'warning',
      page: '2',
      per_page: '10',
    })
    expect(result).toEqual(page)
  })

  it('omits filters that are not set', async () => {
    const fetchMock = stubFetch({ data: [], links: {}, meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 } })

    await listLogGroups(3)

    expect(new URL(fetchMock.mock.calls[0][0]).search).toBe('')
  })

  it('unwraps the group with its events', async () => {
    const event = {
      id: 1,
      level: 'error',
      message: 'boom',
      context: null,
      occurred_at: '2026-10-02T10:00:00.000000Z',
      received_at: '2026-10-02T10:00:01.000000Z',
    }
    const fetchMock = stubFetch({ data: { ...group, events: [event] } })

    const result = await getLogGroup(3, 7)

    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/api/projects/3/log-groups/7')
    expect(result.events).toEqual([event])
    expect(result.id).toBe(7)
  })

  it('rejects when the API answers an error', async () => {
    stubFetch({ message: 'Not found' }, 404)

    await expect(getLogGroup(3, 99)).rejects.toMatchObject({ status: 404 })
  })
})

describe('getHourlyCounts', () => {
  const series = Array.from({ length: 24 }, (_, i) => (i === 23 ? 4 : 0))

  it('requests the ids as CSV and unwraps the counts', async () => {
    const data = { from: '2026-10-07T11:00:00.000000Z', hours: 24, counts: { '7': series, '9': series } }
    const fetchMock = stubFetch({ data })

    const result = await getHourlyCounts(3, [7, 9])

    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/api/projects/3/log-groups/hourly')
    expect(url.searchParams.get('ids')).toBe('7,9')
    expect(result).toEqual(data)
    expect(result.counts['7']).toHaveLength(24)
  })

  it('accepts an empty counts object', async () => {
    stubFetch({ data: { from: '2026-10-07T11:00:00.000000Z', hours: 24, counts: {} } })

    const result = await getHourlyCounts(3, [999])

    expect(result.counts).toEqual({})
  })

  it('rejects when the API answers an error', async () => {
    stubFetch({ message: 'The given data was invalid.' }, 422)

    await expect(getHourlyCounts(3, [])).rejects.toMatchObject({ status: 422 })
  })
})

describe('statusFrom', () => {
  it('returns the status of a valid group', () => {
    expect(statusFrom({ ...group, status: 'resolved' })).toBe('resolved')
  })

  it('returns null for an unknown status, an empty response or undefined', () => {
    expect(statusFrom({ ...group, status: 'archived' as LogGroup['status'] })).toBeNull()
    expect(statusFrom({} as LogGroup)).toBeNull()
    expect(statusFrom(undefined)).toBeNull()
  })
})
