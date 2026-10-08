import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { Message, MessagePayload } from '../api/types'
import SystemNotice from '../components/SystemNotice.vue'
import { i18n } from '../i18n'
import { useMessagesStore } from '../stores/messages'
import { HOURLY_BATCH_SIZE, hourlyCountsOf, requestHourlyCounts, resetHourlyCounts } from './useHourlyCounts'

const HOURLY_PATH = '/api/projects/3/log-groups/hourly'

const notice = (id: number, groupId: number): Message => ({
  id,
  channel_id: 7,
  kind: 'system',
  body: null,
  payload: { type: 'log.group_opened', log_group_id: groupId, level: 'error', title: `Group ${groupId}`, events_count: 1 } as MessagePayload,
  log_group_id: groupId,
  user: null,
  created_at: '2026-01-01T00:00:00Z',
})

const series = (value: number) => Array.from({ length: 24 }, () => value)

function idsOf(call: unknown[]): number[] {
  const options = call[1] as { query: { ids: string } }
  return options.query.ids.split(',').map(Number)
}

function mockHourly(value = 1) {
  return vi.spyOn(api, 'get').mockImplementation(async (_path: string, options?: unknown) => {
    const ids = (options as { query: { ids: string } }).query.ids.split(',')
    return { data: { from: '2026-01-01T00:00:00Z', hours: 24, counts: Object.fromEntries(ids.map((id) => [id, series(value)])) } } as never
  })
}

function mountNotice(message: Message, withProject = true) {
  return mount(SystemNotice, { props: { message, projectId: withProject ? 3 : undefined }, global: { plugins: [i18n] } })
}

describe('useHourlyCounts', () => {
  beforeEach(() => resetHourlyCounts())

  afterEach(() => {
    resetHourlyCounts()
    vi.restoreAllMocks()
  })

  it('loads all notices mounted in the same tick with a single request', async () => {
    const spy = mockHourly()
    const wrappers = [mountNotice(notice(1, 5)), mountNotice(notice(2, 6)), mountNotice(notice(3, 5))]
    await flushPromises()
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toBe(HOURLY_PATH)
    expect(idsOf(spy.mock.calls[0]).sort()).toEqual([5, 6])
    for (const wrapper of wrappers) expect(wrapper.find('.sparkline').exists()).toBe(true)
  })

  it('splits more than 100 groups into chunks', async () => {
    const spy = mockHourly()
    const total = HOURLY_BATCH_SIZE + 20
    for (let groupId = 1; groupId <= total; groupId++) requestHourlyCounts(3, groupId, groupId)
    await flushPromises()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(idsOf(spy.mock.calls[0])).toHaveLength(HOURLY_BATCH_SIZE)
    expect(idsOf(spy.mock.calls[1])).toHaveLength(20)
    expect(new Set(spy.mock.calls.flatMap(idsOf)).size).toBe(total)
  })

  it('makes no request for notices without a project', async () => {
    const spy = mockHourly()
    const wrapper = mountNotice(notice(1, 5), false)
    await flushPromises()
    expect(spy).not.toHaveBeenCalled()
    expect(wrapper.find('.sparkline').exists()).toBe(false)
  })

  it('refreshes a group when a newer notice arrives but not for older or repeated ones', async () => {
    const spy = mockHourly(1)
    const first = mountNotice(notice(10, 5))
    await flushPromises()
    expect(spy).toHaveBeenCalledOnce()

    mountNotice(notice(4, 5))
    mountNotice(notice(10, 5))
    await flushPromises()
    expect(spy).toHaveBeenCalledOnce()

    spy.mockRestore()
    const refreshed = mockHourly(2)
    mountNotice(notice(11, 5))
    await flushPromises()
    expect(refreshed).toHaveBeenCalledOnce()
    expect(hourlyCountsOf(5)).toEqual(series(2))
    expect(first.find('.sparkline').attributes('data-flat')).toBe('false')
  })

  it('discards a stale response for a group that was refreshed meanwhile', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((resolve) => resolvers.push(resolve as (value: unknown) => void)))
    requestHourlyCounts(3, 5, 1)
    await flushPromises()
    requestHourlyCounts(3, 5, 2)
    await flushPromises()
    expect(resolvers).toHaveLength(2)
    resolvers[1]({ data: { from: '', hours: 24, counts: { '5': series(2) } } })
    await flushPromises()
    resolvers[0]({ data: { from: '', hours: 24, counts: { '5': series(1) } } })
    await flushPromises()
    expect(hourlyCountsOf(5)).toEqual(series(2))
  })

  it('shows no sparkline when the request fails or the group is omitted', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('down'))
    const failed = mountNotice(notice(1, 5))
    await flushPromises()
    expect(failed.find('.sparkline').exists()).toBe(false)
    expect(failed.find('.system-notice__title').text()).toBe('Group 5')

    vi.spyOn(api, 'get').mockResolvedValueOnce({ data: { from: '', hours: 24, counts: {} } } as never)
    const omitted = mountNotice(notice(2, 6))
    await flushPromises()
    expect(omitted.find('.sparkline').exists()).toBe(false)
  })

  it('retries the same message id after a failed request', async () => {
    const spy = vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('down'))
    requestHourlyCounts(3, 5, 10)
    await flushPromises()
    expect(hourlyCountsOf(5)).toBeNull()

    spy.mockResolvedValueOnce({ data: { from: '', hours: 24, counts: { '5': series(4) } } } as never)
    requestHourlyCounts(3, 5, 10)
    await flushPromises()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(hourlyCountsOf(5)).toEqual(series(4))
  })

  it('clears the cache and drops in-flight responses on reset', async () => {
    mockHourly()
    requestHourlyCounts(3, 5, 1)
    await flushPromises()
    expect(hourlyCountsOf(5)).toEqual(series(1))

    let release: (value: unknown) => void = () => {}
    let signal: AbortSignal | undefined
    vi.spyOn(api, 'get').mockImplementation(
      (_path: string, options?: unknown) =>
        new Promise((resolve, reject) => {
          signal = (options as { signal?: AbortSignal }).signal
          release = resolve as (value: unknown) => void
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
    requestHourlyCounts(3, 6, 2)
    await flushPromises()
    expect(signal?.aborted).toBe(false)
    resetHourlyCounts()
    expect(signal?.aborted).toBe(true)
    expect(hourlyCountsOf(5)).toBeNull()
    release({ data: { from: '', hours: 24, counts: { '6': series(3) } } })
    await flushPromises()
    expect(hourlyCountsOf(6)).toBeNull()
  })

  it('is cleared when the messages store is cleared (channel or organization change)', async () => {
    setActivePinia(createPinia())
    const spy = mockHourly()
    requestHourlyCounts(3, 5, 10)
    await flushPromises()
    expect(hourlyCountsOf(5)).not.toBeNull()

    useMessagesStore().clear()
    expect(hourlyCountsOf(5)).toBeNull()
    requestHourlyCounts(3, 5, 10)
    await flushPromises()
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
