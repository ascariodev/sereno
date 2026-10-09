import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Message, MessageDeletedEvent } from '../api/types'
import { config } from '../config'
import { createFakeRealtimeClient } from '../test/fakeRealtimeClient'
import {
  createAuthorizer,
  disconnectRealtime,
  joinSession,
  leaveOrganization,
  MEMBERSHIP_REVOKED_EVENT,
  MEMBERSHIP_ROLE_CHANGED_EVENT,
  MENTION_CREATED_EVENT,
  MENTION_REMOVED_EVENT,
  MESSAGE_CREATED_EVENT,
  MESSAGE_DELETED_EVENT,
  MESSAGE_UPDATED_EVENT,
  onChannelDenied,
  onReconnect,
  setRealtimeClientFactory,
  setRealtimeTokenProvider,
  subscribeToChannel,
  subscribeToUser,
} from './echo'

describe('realtime', () => {
  afterEach(() => {
    setRealtimeClientFactory(() => null)
    setRealtimeTokenProvider(() => null)
  })

  it('subscribes to the private channel and forwards message.created', () => {
    const { client, listeners } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const received: Message[] = []
    const leave = subscribeToChannel(3, 7, { onCreated: (message) => received.push(message) })

    expect(client.private).toHaveBeenCalledWith('organizations.3.channels.7')
    listeners.get(`organizations.3.channels.7|${MESSAGE_CREATED_EVENT}`)?.({ message: { id: 9, channel_id: 7 } as Message })
    expect(received.map((message) => message.id)).toEqual([9])

    leave()
    expect(client.leave).toHaveBeenCalledWith('organizations.3.channels.7')
  })

  it('forwards message.updated and message.deleted to their handlers', () => {
    const { client, listeners } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const updated: number[] = []
    const deleted: MessageDeletedEvent[] = []
    const created: number[] = []
    subscribeToChannel(3, 7, {
      onCreated: (message) => created.push(message.id),
      onUpdated: (message) => updated.push(message.id),
      onDeleted: (event) => deleted.push(event),
    })
    const emit = (event: string, data: object) => listeners.get(`organizations.3.channels.7|${event}`)?.(data)
    const root = { id: 4, replies_count: 1, last_reply_at: null }

    emit(MESSAGE_UPDATED_EVENT, { message: { id: 9, channel_id: 7 } })
    emit(MESSAGE_UPDATED_EVENT, { message: { id: 10 } })
    emit(MESSAGE_UPDATED_EVENT, { message: { channel_id: 7 } })
    emit(MESSAGE_CREATED_EVENT, { message: { id: '11', channel_id: 7 } })
    emit(MESSAGE_CREATED_EVENT, { message: { id: 11, channel_id: '7' } })
    emit(MESSAGE_DELETED_EVENT, { id: 5, channel_id: 7, parent_id: 4, deleted_at: '2026-10-09T10:00:00Z', root })
    emit(MESSAGE_DELETED_EVENT, { id: 5, channel_id: 7 })

    expect(created).toEqual([])
    expect(updated).toEqual([9])
    expect(deleted).toEqual([{ id: 5, channel_id: 7, parent_id: 4, deleted_at: '2026-10-09T10:00:00Z', root }])
  })

  it('keeps the channel open until the last subscriber to it leaves', () => {
    const { client, listeners } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const first: number[] = []
    const second: number[] = []
    const leaveFirst = subscribeToChannel(3, 7, { onCreated: (message) => first.push(message.id) })
    const leaveSecond = subscribeToChannel(3, 7, { onCreated: (message) => second.push(message.id) })
    const emit = (id: number) =>
      listeners.get(`organizations.3.channels.7|${MESSAGE_CREATED_EVENT}`)?.({ message: { id, channel_id: 7 } as Message })

    emit(1)
    leaveFirst()
    leaveFirst()
    expect(client.leave).not.toHaveBeenCalled()
    emit(2)
    expect(first).toEqual([1])
    expect(second).toEqual([1, 2])

    leaveSecond()
    expect(client.leave).toHaveBeenCalledTimes(1)
    expect(client.leave).toHaveBeenCalledWith('organizations.3.channels.7')
  })

  it('delivers to the other subscribers when one callback throws, and rethrows asynchronously', () => {
    const { client, listeners } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const received: number[] = []
    subscribeToChannel(3, 7, {
      onCreated: () => {
        throw new Error('boom')
      },
    })
    subscribeToChannel(3, 7, { onCreated: (message) => received.push(message.id) })
    const deferred: Array<() => void> = []
    const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => void deferred.push(task))
    listeners.get(`organizations.3.channels.7|${MESSAGE_CREATED_EVENT}`)?.({ message: { id: 5, channel_id: 7 } as Message })
    spy.mockRestore()
    expect(received).toEqual([5])
    expect(deferred).toHaveLength(1)
    expect(() => deferred[0]()).toThrow('boom')
  })

  it('creates a new listener after disconnect and the old unsubscribe does not close the new one', () => {
    const first = createFakeRealtimeClient()
    const second = createFakeRealtimeClient()
    const clients = [first.client, second.client]
    setRealtimeClientFactory(() => clients.shift() ?? null)
    const leaveOld = subscribeToChannel(3, 7, { onCreated: () => {} })
    disconnectRealtime()
    const received: number[] = []
    const leaveNew = subscribeToChannel(3, 7, { onCreated: (message) => received.push(message.id) })
    expect(second.client.private).toHaveBeenCalledWith('organizations.3.channels.7')

    leaveOld()
    second.listeners.get(`organizations.3.channels.7|${MESSAGE_CREATED_EVENT}`)?.({ message: { id: 8, channel_id: 7 } as Message })
    expect(received).toEqual([8])
    expect(second.client.leave).not.toHaveBeenCalled()
    leaveNew()
    expect(second.client.leave).toHaveBeenCalledTimes(1)
  })

  it('reuses one client and creates a new one after disconnect', () => {
    const factory = vi.fn(() => createFakeRealtimeClient().client)
    setRealtimeClientFactory(factory)
    subscribeToChannel(1, 1, { onCreated: () => {} })
    subscribeToChannel(1, 2, { onCreated: () => {} })
    expect(factory).toHaveBeenCalledTimes(1)

    const first = factory.mock.results[0].value
    disconnectRealtime()
    expect(first.disconnect).toHaveBeenCalledOnce()
    subscribeToChannel(1, 1, { onCreated: () => {} })
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('calls back only when connected again after a drop, not on the initial connection', () => {
    const { client, setStatus, statusListeners } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const callback = vi.fn()
    const off = onReconnect(callback)

    setStatus('connected')
    expect(callback).not.toHaveBeenCalled()
    setStatus('connecting')
    setStatus('connected')
    expect(callback).toHaveBeenCalledTimes(1)
    setStatus('failed')
    setStatus('failed')
    setStatus('connected')
    expect(callback).toHaveBeenCalledTimes(2)

    off()
    expect(statusListeners.size).toBe(0)
  })

  it('does not call back when the connection never came up before failing', () => {
    const { client, setStatus } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const callback = vi.fn()
    onReconnect(callback)
    setStatus('failed')
    setStatus('connected')
    expect(callback).not.toHaveBeenCalled()
  })

  it('subscribes to the user channel and forwards membership.revoked with the organization id', () => {
    const { client, listeners } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const received: number[] = []
    const leave = subscribeToUser(5, { onMembershipRevoked: (organizationId) => received.push(organizationId) })

    expect(client.private).toHaveBeenCalledWith('users.5')
    const emit = listeners.get(`users.5|${MEMBERSHIP_REVOKED_EVENT}`)
    emit?.({})
    emit?.({ organization_id: 3 })
    expect(received).toEqual([3])

    leave()
    expect(client.leave).toHaveBeenCalledWith('users.5')
  })

  it('forwards membership.role_changed with organization and role, ignoring malformed payloads', () => {
    const { client, listeners } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const revoked: number[] = []
    const changed: Array<[number, string]> = []
    subscribeToUser(5, {
      onMembershipRevoked: (organizationId) => revoked.push(organizationId),
      onRoleChanged: (organizationId, role) => changed.push([organizationId, role]),
    })

    const emit = listeners.get(`users.5|${MEMBERSHIP_ROLE_CHANGED_EVENT}`)
    emit?.({ organization_id: 3 })
    emit?.({ role: 'admin' })
    emit?.({ organization_id: 3, role: 'admin' })
    expect(changed).toEqual([[3, 'admin']])
    expect(revoked).toEqual([])
    expect(client.private).toHaveBeenCalledTimes(1)
  })

  it('forwards mention.created with organization, channel, parent and message, ignoring malformed payloads', () => {
    const { client, listeners } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const received: unknown[] = []
    const revoked: number[] = []
    subscribeToUser(5, { onMembershipRevoked: (id) => revoked.push(id), onMention: (mention) => received.push(mention) })

    const emit = listeners.get(`users.5|${MENTION_CREATED_EVENT}`)
    emit?.({ channel_id: 4, message: { id: 9 } as Message })
    emit?.({ organization_id: 3, channel_id: 4 })
    emit?.({ organization_id: 3, message: { id: 9 } as Message })
    emit?.({ organization_id: 3, channel_id: 4, parent_id: 2, message: { id: 9 } as Message })
    emit?.({ organization_id: 3, channel_id: 4, message: { id: 10 } as Message })
    expect(received).toEqual([
      { organizationId: 3, channelId: 4, parentId: 2, message: { id: 9 } },
      { organizationId: 3, channelId: 4, parentId: null, message: { id: 10 } },
    ])
    expect(revoked).toEqual([])
    expect(client.private).toHaveBeenCalledTimes(1)
  })

  it('forwards mention.removed with ids only, ignoring malformed payloads', () => {
    const { client, listeners } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const received: unknown[] = []
    subscribeToUser(5, { onMentionRemoved: (mention) => received.push(mention) })

    const emit = listeners.get(`users.5|${MENTION_REMOVED_EVENT}`)
    emit?.({ channel_id: 4, message_id: 9 })
    emit?.({ organization_id: 3, channel_id: 4 })
    emit?.({ organization_id: 3, message_id: 9 })
    emit?.({ organization_id: 3, channel_id: 4, parent_id: 2, message_id: 9 })
    emit?.({ organization_id: 3, channel_id: 4, message_id: 10 })
    expect(received).toEqual([
      { organizationId: 3, channelId: 4, parentId: 2, messageId: 9 },
      { organizationId: 3, channelId: 4, parentId: null, messageId: 10 },
    ])
    expect(client.private).toHaveBeenCalledTimes(1)
  })

  it('shares one user channel for both events and leaves it with the last subscriber', () => {
    const { client } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const leaveFirst = subscribeToUser(5)
    const leaveSecond = subscribeToUser(5)
    expect(client.private).toHaveBeenCalledTimes(1)
    leaveFirst()
    expect(client.leave).not.toHaveBeenCalled()
    leaveSecond()
    expect(client.leave).toHaveBeenCalledTimes(1)
  })

  it('keeps the user channel open until its last subscriber leaves', () => {
    const { client } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const leaveFirst = subscribeToUser(5)
    const leaveSecond = subscribeToUser(5)
    expect(client.private).toHaveBeenCalledTimes(1)
    leaveFirst()
    expect(client.leave).not.toHaveBeenCalled()
    leaveSecond()
    expect(client.leave).toHaveBeenCalledTimes(1)
  })

  it('leaveOrganization drops only the channels of that organization and stops delivery', () => {
    const { client, listeners } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const dropped: number[] = []
    const kept: number[] = []
    const leaveA = subscribeToChannel(3, 7, { onCreated: (message) => dropped.push(message.id) })
    subscribeToChannel(3, 8, { onCreated: () => {} })
    subscribeToChannel(30, 7, { onCreated: (message) => kept.push(message.id) })
    subscribeToUser(3)

    leaveOrganization(3)

    expect(client.leave).toHaveBeenCalledTimes(2)
    expect(client.leave).toHaveBeenCalledWith('organizations.3.channels.7')
    expect(client.leave).toHaveBeenCalledWith('organizations.3.channels.8')
    listeners.get(`organizations.3.channels.7|${MESSAGE_CREATED_EVENT}`)?.({ message: { id: 1, channel_id: 7 } as Message })
    listeners.get(`organizations.30.channels.7|${MESSAGE_CREATED_EVENT}`)?.({ message: { id: 2, channel_id: 7 } as Message })
    expect(dropped).toEqual([])
    expect(kept).toEqual([2])

    leaveA()
    expect(client.leave).toHaveBeenCalledTimes(2)
  })

  it('delivers nothing and leaves nothing after disconnectRealtime', () => {
    const { client } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const leave = subscribeToUser(5)
    disconnectRealtime()
    leave()
    leaveOrganization(3)
    expect(client.leave).not.toHaveBeenCalled()
    expect(client.disconnect).toHaveBeenCalledOnce()
  })

  it('joins the session presence channel, not a private one, and leaves it', () => {
    const { client } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const leave = joinSession(5)

    expect(client.join).toHaveBeenCalledWith('sessions.5')
    expect(client.private).not.toHaveBeenCalled()
    leave()
    expect(client.leave).toHaveBeenCalledWith('sessions.5')
  })

  it('keeps the session channel until its last subscriber leaves, and ignores a stale unsubscribe after reconnect', () => {
    const first = createFakeRealtimeClient()
    const second = createFakeRealtimeClient()
    const clients = [first.client, second.client]
    setRealtimeClientFactory(() => clients.shift() ?? null)
    const leaveA = joinSession(5)
    const leaveB = joinSession(5)
    expect(first.client.join).toHaveBeenCalledTimes(1)
    leaveA()
    expect(first.client.leave).not.toHaveBeenCalled()

    disconnectRealtime()
    const leaveNew = joinSession(5)
    expect(second.client.join).toHaveBeenCalledWith('sessions.5')
    leaveB()
    expect(first.client.leave).not.toHaveBeenCalled()
    expect(second.client.leave).not.toHaveBeenCalled()
    leaveNew()
    expect(second.client.leave).toHaveBeenCalledTimes(1)
  })

  it('does not leave the session channel after disconnectRealtime', () => {
    const { client } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const leave = joinSession(5)
    disconnectRealtime()
    leave()
    expect(client.leave).not.toHaveBeenCalled()
  })

  it('notifies the organization and status when its channel is rejected, and drops it without a second leave', () => {
    const { client, rejectChannel } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const denied = vi.fn()
    onChannelDenied(denied)
    const leave = subscribeToChannel(3, 7, { onCreated: () => {} })

    rejectChannel('organizations.3.channels.7', { type: 'AuthError', status: 403 })
    expect(denied).toHaveBeenCalledWith(3, 403)
    rejectChannel('organizations.3.channels.7', { type: 'AuthError', status: 403 })
    leave()
    expect(denied).toHaveBeenCalledTimes(1)
    expect(client.leave).toHaveBeenCalledTimes(1)
    expect(client.leave).toHaveBeenCalledWith('organizations.3.channels.7')
    subscribeToChannel(3, 7, { onCreated: () => {} })
    expect(client.private).toHaveBeenCalledTimes(2)
  })

  it('does not attribute a stale authorizer status to a later rejection without status', async () => {
    const { client, rejectChannel } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const denied = vi.fn()
    onChannelDenied(denied)
    const name = 'private-organizations.3.channels.7'
    subscribeToChannel(3, 7, { onCreated: () => {} })
    const first = vi.fn()
    createAuthorizer(async () => new Response('{}', { status: 403 }))({ socketId: '1.2', channelName: name }, first)
    await vi.waitFor(() => expect(first).toHaveBeenCalled())
    rejectChannel('organizations.3.channels.7', { type: 'AuthError', error: 'x' })
    expect(denied).toHaveBeenLastCalledWith(3, 403)

    subscribeToChannel(3, 7, { onCreated: () => {} })
    const second = vi.fn()
    createAuthorizer(async () => new Response('{}', { status: 403 }))({ socketId: '1.2', channelName: name }, second)
    await vi.waitFor(() => expect(second).toHaveBeenCalled())
    const third = vi.fn()
    createAuthorizer(async () => Promise.reject(new TypeError('network')))({ socketId: '1.2', channelName: name }, third)
    await vi.waitFor(() => expect(third).toHaveBeenCalled())
    rejectChannel('organizations.3.channels.7', { type: 'AuthError', error: 'x' })
    expect(denied).toHaveBeenLastCalledWith(3, undefined)
  })

  it('ignores a non numeric status in the error payload', () => {
    const { client, rejectChannel } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const denied = vi.fn()
    onChannelDenied(denied)
    subscribeToChannel(3, 7, { onCreated: () => {} })
    rejectChannel('organizations.3.channels.7', { status: '403' as unknown as number })
    expect(denied).toHaveBeenCalledWith(3, undefined)
  })

  it('releases the rejected channel in the client so a later subscription authorizes again', () => {
    const { client, rejectChannel } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const leave = subscribeToChannel(3, 7, { onCreated: () => {} })
    rejectChannel('organizations.3.channels.7', { status: 403 })
    expect(client.leave).toHaveBeenCalledTimes(1)
    leave()
    expect(client.leave).toHaveBeenCalledTimes(1)
  })

  it('takes the status from the authorizer when the payload carries none', async () => {
    setRealtimeTokenProvider(() => 'secret')
    const { client, rejectChannel } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const denied = vi.fn()
    onChannelDenied(denied)
    subscribeToChannel(3, 7, { onCreated: () => {} })
    const callback = vi.fn()
    createAuthorizer(async () => new Response('{}', { status: 403 }))(
      { socketId: '1.2', channelName: 'private-organizations.3.channels.7' },
      callback,
    )
    await vi.waitFor(() => expect(callback).toHaveBeenCalled())

    rejectChannel('organizations.3.channels.7', { type: 'AuthError', error: 'x' })
    expect(denied).toHaveBeenCalledWith(3, 403)
  })

  it('does not notify when a user channel is rejected, nor after unsubscribing the callback', () => {
    const { client, rejectChannel } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const denied = vi.fn()
    const off = onChannelDenied(denied)
    subscribeToUser(5)
    subscribeToChannel(3, 7, { onCreated: () => {} })

    rejectChannel('users.5', { status: 403 })
    expect(denied).not.toHaveBeenCalled()
    off()
    rejectChannel('organizations.3.channels.7', { status: 403 })
    expect(denied).not.toHaveBeenCalled()
  })

  it('does nothing without a client (no Reverb key)', () => {
    setRealtimeClientFactory(() => null)
    expect(() => subscribeToChannel(1, 1, { onCreated: () => {} })()).not.toThrow()
  })

  it('authorizes with the Bearer token and without the organization header', async () => {
    setRealtimeTokenProvider(() => 'secret')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ auth: 'key:sig' }), { status: 200 }))
    const callback = vi.fn()
    createAuthorizer(fetchMock)({ socketId: '1.2', channelName: 'private-organizations.3.channels.7' }, callback)
    await vi.waitFor(() => expect(callback).toHaveBeenCalled())

    expect(callback).toHaveBeenCalledWith(null, { auth: 'key:sig' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${config.apiUrl}/broadcasting/auth`)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer secret')
    expect(headers).not.toHaveProperty('X-Organization-Id')
    expect(JSON.parse(String(init.body))).toEqual({ socket_id: '1.2', channel_name: 'private-organizations.3.channels.7' })
  })

  it('reports an error when the authorization is rejected', async () => {
    const callback = vi.fn()
    createAuthorizer(async () => new Response('{}', { status: 403 }))({ socketId: '1.2', channelName: 'x' }, callback)
    await vi.waitFor(() => expect(callback).toHaveBeenCalled())
    expect(callback.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(callback.mock.calls[0][1]).toBeNull()
  })
})
