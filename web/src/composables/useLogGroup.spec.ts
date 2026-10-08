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
    expect(state.loading.value).toBe(false)
    expect(state.group.value?.title).toBe('Timeout in webhook')
    expect(state.loadError.value).toBeNull()
  })

  it('reports notFound on 404 and failed otherwise', async () => {
    vi.spyOn(api, 'get')
      .mockRejectedValueOnce(new ApiError(404, 'Not found'))
      .mockRejectedValueOnce(new ApiError(500, 'Boom'))
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
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ data: group() } as never)
      .mockResolvedValueOnce({ data: group({ status: 'resolved' }) } as never)
    const wrapper = mountComposable({ groupId: 5, refreshToken: 0 })
    await flushPromises()
    await wrapper.setProps({ refreshToken: 1 })
    expect(state.group.value).not.toBeNull()
    expect(state.loading.value).toBe(false)
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(state.group.value?.status).toBe('resolved')
  })

  it('keeps the previous group with a loadError when a refresh fails', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ data: group() } as never)
      .mockRejectedValueOnce(new ApiError(500, 'Boom'))
    const wrapper = mountComposable({ groupId: 5, refreshToken: 0 })
    await flushPromises()
    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
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
})
