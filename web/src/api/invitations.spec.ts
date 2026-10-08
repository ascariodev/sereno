import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptInvitation, createInvitation, listInvitations, previewInvitation, revokeInvitation } from './invitations'
import type { Invitation } from './types'

const invitation: Invitation = {
  id: 4,
  email: 'ana@example.com',
  role: 'member',
  locale: 'en',
  invited_by: { id: 1, name: 'Owner' },
  expires_at: '2026-10-15T10:00:00.000000Z',
  created_at: '2026-10-08T10:00:00.000000Z',
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

describe('invitations client', () => {
  it('previews by token and unwraps the nested organization', async () => {
    const data = {
      organization: { name: 'Acme' },
      email: 'ana@example.com',
      role: 'member',
      expires_at: '2026-10-15T10:00:00.000000Z',
    }
    const fetchMock = stubFetch({ data })

    const result = await previewInvitation('a/b c')

    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/api/invitations/a%2Fb%20c')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET')
    expect(result).toEqual(data)
  })

  it('rejects the preview with the 404 of an unusable invitation', async () => {
    stubFetch({ message: 'The invitation is invalid or has expired.' }, 404)

    await expect(previewInvitation('x')).rejects.toMatchObject({
      status: 404,
      message: 'The invitation is invalid or has expired.',
    })
  })

  it('accepts by posting the token and unwraps the organization id', async () => {
    const fetchMock = stubFetch({ data: { organization_id: 9 } })

    const result = await acceptInvitation('tok')

    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url).pathname).toBe('/api/invitations/accept')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ token: 'tok' })
    expect(result).toEqual({ organization_id: 9 })
  })

  it('rejects accept with 422 for an invalid invitation and 403 for another email', async () => {
    stubFetch({ message: 'The invitation is invalid or has expired.' }, 422)
    await expect(acceptInvitation('x')).rejects.toMatchObject({ status: 422 })

    stubFetch({ message: 'This invitation was issued for a different email address.' }, 403)
    await expect(acceptInvitation('x')).rejects.toMatchObject({ status: 403 })
  })

  it('lists pending invitations unwrapping data', async () => {
    const fetchMock = stubFetch({ data: [invitation, { ...invitation, id: 5, invited_by: null }] })

    const result = await listInvitations()

    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/api/invitations')
    expect(result).toHaveLength(2)
    expect(result[1].invited_by).toBeNull()
  })

  it('creates with email and role and unwraps the invitation', async () => {
    const fetchMock = stubFetch({ data: invitation }, 201)

    const result = await createInvitation('ana@example.com', 'member')

    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url).pathname).toBe('/api/invitations')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'ana@example.com', role: 'member' })
    expect(result).toEqual(invitation)
  })

  it('exposes the 422 field errors when creating', async () => {
    stubFetch({ message: 'invalid', errors: { email: ['The email field is required.'] } }, 422)

    await expect(createInvitation('', 'member')).rejects.toMatchObject({
      status: 422,
      errors: { email: ['The email field is required.'] },
    })
  })

  it('exposes 403 when creating without permission', async () => {
    stubFetch({ message: 'This action is unauthorized.' }, 403)

    await expect(createInvitation('a@b.co', 'owner')).rejects.toMatchObject({ status: 403 })
  })

  it('revokes with DELETE and resolves with no body on 204', async () => {
    const fetchMock = stubFetch(null, 204)

    await expect(revokeInvitation(4)).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url).pathname).toBe('/api/invitations/4')
    expect(init?.method).toBe('DELETE')
  })

  it('rejects revoke with 404', async () => {
    stubFetch({ message: 'The invitation is invalid or has expired.' }, 404)

    await expect(revokeInvitation(4)).rejects.toMatchObject({ status: 404 })
  })
})
