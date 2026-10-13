import { afterEach, describe, expect, it, vi } from 'vitest'
import { listNotifications, markNotificationsRead, parseNotification } from './notifications'

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

const row = (type: string, data: unknown, extra: Record<string, unknown> = {}) => ({
  id: 5,
  type,
  project_id: 2,
  data,
  read_at: null,
  created_at: '2026-10-13T10:00:00.000000Z',
  ...extra,
})

const taskData = { task_id: 9, task_key: 'WEB-9', task_title: 'Fix', actor_id: 3, actor_name: 'Ana' }
const commentData = { ...taskData, comment_id: 4, comment_excerpt: 'hi' }
const chatData = {
  channel_id: 6,
  channel_name: 'general',
  message_id: 7,
  parent_id: null,
  message_excerpt: 'yo',
  actor_id: 3,
  actor_name: 'Ana',
}

describe('parseNotification', () => {
  it.each([
    ['task_assigned', taskData],
    ['task_comment_mention', commentData],
    ['task_commented', commentData],
    ['chat_mention', chatData],
    ['chat_mention', { ...chatData, parent_id: 12 }],
  ])('keeps a well formed %s', (type, data) => {
    expect(parseNotification(row(type, data))).toEqual(row(type, data))
  })

  it('falls back to the generic variant for an unknown type, keeping the original', () => {
    expect(parseNotification(row('future_thing', { a: 1 }))).toEqual(row('unknown', { a: 1 }, { original_type: 'future_thing' }))
    expect(parseNotification(row('constructor', {}))?.type).toBe('unknown')
  })

  it('falls back to the generic variant when a known type misses a field or has a wrong one', () => {
    const { task_title: _title, ...incomplete } = taskData
    expect(parseNotification(row('task_assigned', incomplete))?.type).toBe('unknown')
    expect(parseNotification(row('task_commented', { ...commentData, comment_id: '4' }))?.type).toBe('unknown')
    expect(parseNotification(row('chat_mention', { ...chatData, parent_id: undefined }))?.type).toBe('unknown')
    expect(parseNotification(row('chat_mention', { ...chatData, parent_id: 'x' }))?.type).toBe('unknown')
  })

  it('accepts an empty data object and a read row without project', () => {
    const parsed = parseNotification(row('x', {}, { project_id: null, read_at: '2026-10-13T11:00:00Z' }))
    expect(parsed).toMatchObject({ type: 'unknown', project_id: null, read_at: '2026-10-13T11:00:00Z', data: {} })
  })

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['an array', []],
    ['no id', row('task_assigned', taskData, { id: undefined })],
    ['string id', row('task_assigned', taskData, { id: '5' })],
    ['no type', row('task_assigned', taskData, { type: undefined })],
    ['data as array', row('task_assigned', [])],
    ['data null', row('task_assigned', null)],
    ['bad project_id', row('task_assigned', taskData, { project_id: 'a' })],
    ['missing project_id', row('task_assigned', taskData, { project_id: undefined })],
    ['bad read_at', row('task_assigned', taskData, { read_at: 3 })],
    ['missing created_at', row('task_assigned', taskData, { created_at: undefined })],
  ])('rejects a row with %s', (_label, raw) => {
    expect(parseNotification(raw)).toBeNull()
  })
})

describe('notifications api', () => {
  it('lists with cursor and page size, omitting an absent cursor, and drops malformed rows', async () => {
    const fetchMock = stubFetch({
      data: [row('task_assigned', taskData), { id: 'bad' }],
      meta: { next_cursor: 'n', unread_count: 3 },
    })
    const page = await listNotifications({ cursor: 'abc', perPage: 20 })
    await listNotifications()
    const first = new URL(fetchMock.mock.calls[0][0], 'http://x')
    expect(first.pathname).toBe('/api/notifications')
    expect(first.searchParams.get('cursor')).toBe('abc')
    expect(first.searchParams.get('per_page')).toBe('20')
    expect(new URL(fetchMock.mock.calls[1][0], 'http://x').searchParams.has('cursor')).toBe(false)
    expect(page.data).toHaveLength(1)
    expect(page.meta).toEqual({ next_cursor: 'n', unread_count: 3 })
  })

  it('marks ids or all as read and returns the unread count', async () => {
    const fetchMock = stubFetch({ unread_count: 2 })
    expect(await markNotificationsRead({ ids: [1, 2] })).toBe(2)
    await markNotificationsRead({ all: true })
    expect(new URL(fetchMock.mock.calls[0][0], 'http://x').pathname).toBe('/api/notifications/read')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ ids: [1, 2] })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ all: true })
  })
})
