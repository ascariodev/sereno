import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as projectsApi from '../api/projects'
import type { Member } from '../api/types'
import { MEMBER_DIRECTORY_TTL_MS, useMemberDirectoryStore } from './memberDirectory'
import { useOrganizationStore } from './organization'

const member = (id: number): Member => ({ id, name: `M${id}`, email: `m${id}@x.test`, role: 'member', joined_at: null })
const ids = (list: Member[]) => list.map((m) => m.id)

function setup(orgId: number | null = 1) {
  setActivePinia(createPinia())
  const organization = useOrganizationStore()
  organization.$patch({ activeId: orgId })
  return { organization, directory: useMemberDirectoryStore() }
}

describe('member directory store', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.useRealTimers())

  it('loads once per project and reuses the cache', async () => {
    const list = vi.spyOn(projectsApi, 'listProjectMembers').mockResolvedValue([member(1)])
    const { directory } = setup()
    await Promise.all([directory.ensureLoaded(5), directory.ensureLoaded(5)])
    await directory.ensureLoaded(5)
    expect(list).toHaveBeenCalledTimes(1)
    expect(list.mock.calls[0][0]).toBe(5)
    expect(ids(directory.membersOf(5))).toEqual([1])
  })

  it('keeps one list per project', async () => {
    vi.spyOn(projectsApi, 'listProjectMembers').mockImplementation(async (id) => (id === 5 ? [member(1)] : [member(2), member(3)]))
    const { directory } = setup()
    await Promise.all([directory.ensureLoaded(5), directory.ensureLoaded(6)])
    expect(ids(directory.membersOf(5))).toEqual([1])
    expect(ids(directory.membersOf(6))).toEqual([2, 3])
    expect(directory.membersOf(7)).toEqual([])
    expect(directory.membersOf(null)).toEqual([])
  })

  it('does nothing without an active organization or a project', async () => {
    const list = vi.spyOn(projectsApi, 'listProjectMembers')
    const { directory } = setup(null)
    await directory.ensureLoaded(5)
    expect(list).not.toHaveBeenCalled()
    const { directory: other } = setup()
    await other.ensureLoaded(null)
    expect(list).not.toHaveBeenCalled()
  })

  it('drops the cache when the organization changes and reloads', async () => {
    const list = vi.spyOn(projectsApi, 'listProjectMembers').mockResolvedValueOnce([member(1)]).mockResolvedValueOnce([member(2)])
    const { organization, directory } = setup()
    await directory.ensureLoaded(5)
    organization.$patch({ activeId: 2 })
    expect(directory.membersOf(5)).toEqual([])
    await directory.ensureLoaded(5)
    expect(list).toHaveBeenCalledTimes(2)
    expect(ids(directory.membersOf(5))).toEqual([2])
  })

  it('drops the cache on logout (organization cleared)', async () => {
    vi.spyOn(projectsApi, 'listProjectMembers').mockResolvedValue([member(1)])
    const { organization, directory } = setup()
    await directory.ensureLoaded(5)
    organization.clear()
    expect(directory.membersOf(5)).toEqual([])
  })

  it('discards a response that arrives after the organization changed', async () => {
    let resolveFirst: (value: Member[]) => void = () => {}
    const list = vi
      .spyOn(projectsApi, 'listProjectMembers')
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([member(2)])
    const { organization, directory } = setup()
    const first = directory.ensureLoaded(5)
    organization.$patch({ activeId: 2 })
    await directory.ensureLoaded(5)
    resolveFirst([member(1)])
    await first
    expect(list).toHaveBeenCalledTimes(2)
    expect(ids(directory.membersOf(5))).toEqual([2])
  })

  it('does not cache a failure, so the next call retries', async () => {
    const list = vi.spyOn(projectsApi, 'listProjectMembers').mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce([member(1)])
    const { directory } = setup()
    await directory.ensureLoaded(5)
    expect(directory.membersOf(5)).toEqual([])
    await directory.ensureLoaded(5)
    expect(list).toHaveBeenCalledTimes(2)
    expect(directory.membersOf(5)).toHaveLength(1)
  })

  it('refetches one project after invalidate, keeping the old list meanwhile', async () => {
    const list = vi
      .spyOn(projectsApi, 'listProjectMembers')
      .mockImplementation(async (id) => (id === 5 ? [member(1)] : [member(9)]))
    const { directory } = setup()
    await Promise.all([directory.ensureLoaded(5), directory.ensureLoaded(6)])
    list.mockImplementation(async () => [member(1), member(2)])
    directory.invalidate(5)
    expect(ids(directory.membersOf(5))).toEqual([1])
    await Promise.all([directory.ensureLoaded(5), directory.ensureLoaded(6)])
    expect(list).toHaveBeenCalledTimes(3)
    expect(ids(directory.membersOf(5))).toEqual([1, 2])
    expect(ids(directory.membersOf(6))).toEqual([9])
  })

  it('invalidates every project without an id', async () => {
    const list = vi.spyOn(projectsApi, 'listProjectMembers').mockResolvedValue([member(1)])
    const { directory } = setup()
    await Promise.all([directory.ensureLoaded(5), directory.ensureLoaded(6)])
    directory.invalidate()
    await Promise.all([directory.ensureLoaded(5), directory.ensureLoaded(6)])
    expect(list).toHaveBeenCalledTimes(4)
  })

  it('discards an in-flight response when invalidated', async () => {
    let resolveFirst: (value: Member[]) => void = () => {}
    const list = vi
      .spyOn(projectsApi, 'listProjectMembers')
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([member(2)])
    const { directory } = setup()
    const first = directory.ensureLoaded(5)
    directory.invalidate(5)
    await directory.ensureLoaded(5)
    resolveFirst([member(1)])
    await first
    expect(list).toHaveBeenCalledTimes(2)
    expect(ids(directory.membersOf(5))).toEqual([2])
  })

  it('refetches once the cache is older than the TTL', async () => {
    vi.useFakeTimers()
    const list = vi.spyOn(projectsApi, 'listProjectMembers').mockResolvedValue([member(1)])
    const { directory } = setup()
    await directory.ensureLoaded(5)
    vi.advanceTimersByTime(MEMBER_DIRECTORY_TTL_MS - 1)
    await directory.ensureLoaded(5)
    expect(list).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2)
    await directory.ensureLoaded(5)
    expect(list).toHaveBeenCalledTimes(2)
  })
})
