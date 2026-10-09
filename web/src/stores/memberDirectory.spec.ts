import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as membersApi from '../api/members'
import type { Member } from '../api/types'
import { useMemberDirectoryStore } from './memberDirectory'
import { useOrganizationStore } from './organization'

const member = (id: number): Member => ({ id, name: `M${id}`, email: `m${id}@x.test`, role: 'member', joined_at: null })

function setup(orgId: number | null = 1) {
  setActivePinia(createPinia())
  const organization = useOrganizationStore()
  organization.$patch({ activeId: orgId })
  return { organization, directory: useMemberDirectoryStore() }
}

describe('member directory store', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('loads once per organization and reuses the cache', async () => {
    const list = vi.spyOn(membersApi, 'listMembers').mockResolvedValue([member(1)])
    const { directory } = setup()
    await Promise.all([directory.ensureLoaded(), directory.ensureLoaded()])
    await directory.ensureLoaded()
    expect(list).toHaveBeenCalledTimes(1)
    expect(directory.members.map((m) => m.id)).toEqual([1])
  })

  it('does nothing without an active organization', async () => {
    const list = vi.spyOn(membersApi, 'listMembers')
    const { directory } = setup(null)
    await directory.ensureLoaded()
    expect(list).not.toHaveBeenCalled()
  })

  it('drops the cache when the organization changes and reloads', async () => {
    const list = vi.spyOn(membersApi, 'listMembers').mockResolvedValueOnce([member(1)]).mockResolvedValueOnce([member(2)])
    const { organization, directory } = setup()
    await directory.ensureLoaded()
    organization.$patch({ activeId: 2 })
    expect(directory.members).toEqual([])
    await directory.ensureLoaded()
    expect(list).toHaveBeenCalledTimes(2)
    expect(directory.members.map((m) => m.id)).toEqual([2])
  })

  it('drops the cache on logout (organization cleared)', async () => {
    vi.spyOn(membersApi, 'listMembers').mockResolvedValue([member(1)])
    const { organization, directory } = setup()
    await directory.ensureLoaded()
    organization.clear()
    expect(directory.members).toEqual([])
  })

  it('discards a response that arrives after the organization changed', async () => {
    let resolveFirst: (value: Member[]) => void = () => {}
    const list = vi
      .spyOn(membersApi, 'listMembers')
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([member(2)])
    const { organization, directory } = setup()
    const first = directory.ensureLoaded()
    organization.$patch({ activeId: 2 })
    await directory.ensureLoaded()
    resolveFirst([member(1)])
    await first
    expect(list).toHaveBeenCalledTimes(2)
    expect(directory.members.map((m) => m.id)).toEqual([2])
  })

  it('does not cache a failure, so the next call retries', async () => {
    const list = vi.spyOn(membersApi, 'listMembers').mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce([member(1)])
    const { directory } = setup()
    await directory.ensureLoaded()
    expect(directory.members).toEqual([])
    await directory.ensureLoaded()
    expect(list).toHaveBeenCalledTimes(2)
    expect(directory.members).toHaveLength(1)
  })
})
