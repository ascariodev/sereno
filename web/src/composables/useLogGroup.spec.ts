import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { api, ApiError } from '../api/client'
import type { LogGroup } from '../api/types'
import { useLogGroup } from './useLogGroup'

const group = (overrides: Partial<LogGroup> = {}): LogGroup => ({
  id: 5,
  project_id: 3,
  level: 'error',
  title: 'Timeout in webhook',
  status: 'open',
  events_count: 1,
  first_seen_at: '',
  last_seen_at: '',
  events: [],
  ...overrides,
})

let state: ReturnType<typeof useLogGroup>
let mounted: VueWrapper | undefined

function mountComposable(props: { groupId: number; refreshToken?: number }): VueWrapper {
  const wrapper = mount(
    defineComponent({
      props: { groupId: { type: Number, required: true }, refreshToken: { type: Number, default: undefined } },
      setup(p) {
        state = useLogGroup(
          () => 3,
          () => p.groupId,
          () => p.refreshToken,
        )
        return () => h('div')
      },
    }),
    { props },
  )
  mounted = wrapper
  return wrapper
}

const hourlyPath = '/api/projects/3/log-groups/hourly'
const series = (n: number): number[] => Array.from({ length: 24 }, () => n)
const hourlyBody = (id: number, n: number) => ({ data: { from: '', hours: 24, counts: { [String(id)]: series(n) } } })

beforeEach(() => vi.restoreAllMocks())
afterEach(() => {
  mounted?.unmount()
  mounted = undefined
})

describe('useLogGroup', () => {
  it('loads the group and toggles loading', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: group() } as never)
    mountComposable({ groupId: 5 })
    expect(state.loading.value).toBe(true)
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/api/projects/3/log-groups/5', expect.anything())
    expect(get).toHaveBeenCalledWith(hourlyPath, expect.objectContaining({ query: { ids: '5' } }))
    expect(state.loading.value).toBe(false)
    expect(state.group.value?.title).toBe('Timeout in webhook')
    expect(state.loadError.value).toBeNull()
  })

  it('reports notFound on 404 and failed otherwise', async () => {
    const failures = [new ApiError(404, 'Not found'), new ApiError(500, 'Boom')]
    vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
      if (path === hourlyPath) return hourlyBody(5, 1)
      throw failures.shift()
    }) as never)
    const wrapper = mountComposable({ groupId: 5 })
    await flushPromises()
    expect(state.loadError.value).toBe('notFound')
    expect(state.group.value).toBeNull()
    expect(state.loading.value).toBe(false)
    await wrapper.setProps({ groupId: 6 })
    await flushPromises()
    expect(state.loadError.value).toBe('failed')
  })

  it('discards a stale response when the group changes while loading', async () => {
    const resolvers: Record<string, (value: unknown) => void> = {}
    vi.spyOn(api, 'get').mockImplementation(
      (path: string) => new Promise((resolve) => (resolvers[path] = resolve)) as never,
    )
    const wrapper = mountComposable({ groupId: 5 })
    await wrapper.setProps({ groupId: 6 })
    resolvers['/api/projects/3/log-groups/6']({ data: group({ id: 6, title: 'New one' }) })
    await flushPromises()
    resolvers['/api/projects/3/log-groups/5']({ data: group({ id: 5, title: 'Old one' }) })
    await flushPromises()
    expect(state.group.value?.title).toBe('New one')
  })

  it('reloads without clearing the group when the refresh token changes', async () => {
    const groups = [group(), group({ status: 'resolved' })]
    const get = vi
      .spyOn(api, 'get')
      .mockImplementation((async (path: string) =>
        path === hourlyPath ? hourlyBody(5, 1) : { data: groups.shift() }) as never)
    const wrapper = mountComposable({ groupId: 5, refreshToken: 0 })
    await flushPromises()
    await wrapper.setProps({ refreshToken: 1 })
    expect(state.group.value).not.toBeNull()
    expect(state.loading.value).toBe(false)
    await flushPromises()
    expect(get.mock.calls.filter(([path]) => path !== hourlyPath)).toHaveLength(2)
    expect(state.group.value?.status).toBe('resolved')
  })

  it('keeps the previous group with a loadError when a refresh fails', async () => {
    let groupCalls = 0
    const get = vi
      .spyOn(api, 'get')
      .mockImplementation((async (path: string) => {
        if (path === hourlyPath) return hourlyBody(5, 1)
        if (++groupCalls === 2) throw new ApiError(500, 'Boom')
        return { data: group() }
      }) as never)
    const wrapper = mountComposable({ groupId: 5, refreshToken: 0 })
    await flushPromises()
    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()
    expect(get.mock.calls.filter(([path]) => path !== hourlyPath)).toHaveLength(2)
    expect(state.group.value?.title).toBe('Timeout in webhook')
    expect(state.group.value?.status).toBe('open')
    expect(state.loadError.value).toBe('failed')
    expect(state.loading.value).toBe(false)
  })

  it('applies a status locally and ignores responses after unmount', async () => {
    let resolveGet: (value: unknown) => void = () => {}
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((resolve) => (resolveGet = resolve)) as never)
    const wrapper = mountComposable({ groupId: 5 })
    state.setStatus('resolved')
    expect(state.group.value).toBeNull()
    wrapper.unmount()
    mounted = undefined
    resolveGet({ data: group() })
    await flushPromises()
    expect(state.group.value).toBeNull()
  })

  describe('hourly counts', () => {
    it('loads the series of the group, reloads on the refresh token and keeps it while reloading', async () => {
      let hourlyN = 0
      const get = vi.spyOn(api, 'get').mockImplementation((async (path: string) =>
        path === hourlyPath ? hourlyBody(5, ++hourlyN) : { data: group() }) as never)
      const wrapper = mountComposable({ groupId: 5, refreshToken: 0 })
      expect(state.hourly.value).toBeNull()
      await flushPromises()
      expect(state.hourly.value).toEqual(series(1))
      await wrapper.setProps({ refreshToken: 1 })
      expect(state.hourly.value).toEqual(series(1))
      await flushPromises()
      expect(state.hourly.value).toEqual(series(2))
      expect(get.mock.calls.filter(([path]) => path === hourlyPath)).toHaveLength(2)
    })

    it('stays null without breaking the group when the request fails or the id is missing', async () => {
      let missing = false
      vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
        if (path !== hourlyPath) return { data: group() }
        if (missing) return { data: { from: '', hours: 24, counts: {} } }
        throw new ApiError(500, 'Boom')
      }) as never)
      const wrapper = mountComposable({ groupId: 5, refreshToken: 0 })
      await flushPromises()
      expect(state.hourly.value).toBeNull()
      expect(state.group.value?.title).toBe('Timeout in webhook')
      expect(state.loadError.value).toBeNull()
      missing = true
      await wrapper.setProps({ refreshToken: 1 })
      await flushPromises()
      expect(state.hourly.value).toBeNull()
    })

    it('clears the series when the group changes and discards the stale response', async () => {
      const resolvers: Record<string, (value: unknown) => void> = {}
      vi.spyOn(api, 'get').mockImplementation((async (path: string, options?: { query?: { ids: string } }) => {
        if (path !== hourlyPath) return { data: group() }
        return new Promise((resolve) => (resolvers[options?.query?.ids ?? ''] = resolve))
      }) as never)
      const wrapper = mountComposable({ groupId: 5 })
      await flushPromises()
      resolvers['5'](hourlyBody(5, 1))
      await flushPromises()
      expect(state.hourly.value).toEqual(series(1))
      await wrapper.setProps({ groupId: 6 })
      expect(state.hourly.value).toBeNull()
      await wrapper.setProps({ groupId: 7 })
      await flushPromises()
      resolvers['7'](hourlyBody(7, 7))
      await flushPromises()
      resolvers['6'](hourlyBody(6, 6))
      await flushPromises()
      expect(state.hourly.value).toEqual(series(7))
    })
  })
})
