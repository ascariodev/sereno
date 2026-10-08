import { afterEach, describe, expect, it, vi } from 'vitest'
import { listMembers, removeMember, updateMemberRole } from './members'
import type { Member } from './types'

const member: Member = {
  id: 2,
  name: 'Ana',
  email: 'ana@example.com',
  role: 'member',
  joined_at: '2026-10-08T10:00:00.000000Z',
}

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('members client', () => {
  it('lists members unwrapping data and keeping a null role', async () => {
    const fetchMock = stubFetch({ data: [member, { ...member, id: 3, role: null }] })

    const result = await listMembers()

    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/api/members')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET')
    expect(result).toHaveLength(2)
    expect(result[1].role).toBeNull()
  })

  it('exposes 403 when listing without permission', async () => {
    stubFetch({ message: 'This action is unauthorized.' }, 403)

    await expect(listMembers()).rejects.toMatchObject({ status: 403 })
  })

  it('patches the role and unwraps the member', async () => {
    const fetchMock = stubFetch({ data: { ...member, role: 'admin' } })

    const result = await updateMemberRole(2, 'admin')

    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url).pathname).toBe('/api/members/2')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(init?.body as string)).toEqual({ role: 'admin' })
    expect(result.role).toBe('admin')
  })

  it('exposes 422 field errors, 403 and 404 when changing the role', async () => {
    stubFetch({ message: 'invalid', errors: { role: ['The organization needs at least one owner.'] } }, 422)
    await expect(updateMemberRole(1, 'member')).rejects.toMatchObject({
      status: 422,
      errors: { role: ['The organization needs at least one owner.'] },
    })

    stubFetch({ message: 'This action is unauthorized.' }, 403)
    await expect(updateMemberRole(1, 'owner')).rejects.toMatchObject({ status: 403 })

    stubFetch({ message: 'Not found.' }, 404)
    await expect(updateMemberRole(99, 'member')).rejects.toMatchObject({ status: 404 })
  })

  it('removes with DELETE and resolves with no body on 204', async () => {
    const fetchMock = stubFetch(null, 204)

    await expect(removeMember(2)).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url).pathname).toBe('/api/members/2')
    expect(init?.method).toBe('DELETE')
  })

  it('rejects remove with 403, 404 and 422', async () => {
    stubFetch({ message: 'This action is unauthorized.' }, 403)
    await expect(removeMember(2)).rejects.toMatchObject({ status: 403 })

    stubFetch({ message: 'Not found.' }, 404)
    await expect(removeMember(99)).rejects.toMatchObject({ status: 404 })

    stubFetch({ message: 'The organization needs at least one owner.' }, 422)
    await expect(removeMember(1)).rejects.toMatchObject({ status: 422 })
  })
})
