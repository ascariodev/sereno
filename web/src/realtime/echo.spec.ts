import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../api/types'
import { config } from '../config'
import { createFakeRealtimeClient } from '../test/fakeRealtimeClient'
import {
  createAuthorizer,
  disconnectRealtime,
  joinSession,
  leaveOrganization,
  MEMBERSHIP_REVOKED_EVENT,
  MEMBERSHIP_ROLE_CHANGED_EVENT,
  MESSAGE_CREATED_EVENT,
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
    const leave = subscribeToChannel(3, 7, (message) => received.push(message))

    expect(client.private).toHaveBeenCalledWith('organizations.3.channels.7')
    listeners.get(`organizations.3.channels.7|${MESSAGE_CREATED_EVENT}`)?.({ message: { id: 9 } as Message })
    expect(received.map((message) => message.id)).toEqual([9])

    leave()
    expect(client.leave).toHaveBeenCalledWith('organizations.3.channels.7')
  })

  it('keeps the channel open until the last subscriber to it leaves', () => {
    const { client, listeners } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const first: number[] = []
    const second: number[] = []
    const leaveFirst = subscribeToChannel(3, 7, (message) => first.push(message.id))
    const leaveSecond = subscribeToChannel(3, 7, (message) => second.push(message.id))
    const emit = (id: number) =>
      listeners.get(`organizations.3.channels.7|${MESSAGE_CREATED_EVENT}`)?.({ message: { id } as Message })

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
    subscribeToChannel(3, 7, () => {
      throw new Error('boom')
    })
    subscribeToChannel(3, 7, (message) => received.push(message.id))
    const deferred: Array<() => void> = []
    const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => void deferred.push(task))
    listeners.get(`organizations.3.channels.7|${MESSAGE_CREATED_EVENT}`)?.({ message: { id: 5 } as Message })
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
    const leaveOld = subscribeToChannel(3, 7, () => {})
    disconnectRealtime()
    const received: number[] = []
    const leaveNew = subscribeToChannel(3, 7, (message) => received.push(message.id))
    expect(second.client.private).toHaveBeenCalledWith('organizations.3.channels.7')

    leaveOld()
    second.listeners.get(`organizations.3.channels.7|${MESSAGE_CREATED_EVENT}`)?.({ message: { id: 8 } as Message })
    expect(received).toEqual([8])
    expect(second.client.leave).not.toHaveBeenCalled()
    leaveNew()
    expect(second.client.leave).toHaveBeenCalledTimes(1)
  })

  it('reuses one client and creates a new one after disconnect', () => {
    const factory = vi.fn(() => createFakeRealtimeClient().client)
    setRealtimeClientFactory(factory)
    subscribeToChannel(1, 1, () => {})
    subscribeToChannel(1, 2, () => {})
    expect(factory).toHaveBeenCalledTimes(1)

    const first = factory.mock.results[0].value
    disconnectRealtime()
    expect(first.disconnect).toHaveBeenCalledOnce()
    subscribeToChannel(1, 1, () => {})
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
    const leave = subscribeToUser(5, (organizationId) => received.push(organizationId))

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
    subscribeToUser(
      5,
      (organizationId) => revoked.push(organizationId),
      (organizationId, role) => changed.push([organizationId, role]),
    )

    const emit = listeners.get(`users.5|${MEMBERSHIP_ROLE_CHANGED_EVENT}`)
    emit?.({ organization_id: 3 })
    emit?.({ role: 'admin' })
    emit?.({ organization_id: 3, role: 'admin' })
    expect(changed).toEqual([[3, 'admin']])
    expect(revoked).toEqual([])
    expect(client.private).toHaveBeenCalledTimes(1)
  })

  it('shares one user channel for both events and leaves it with the last subscriber', () => {
    const { client } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const leaveFirst = subscribeToUser(5, () => {}, () => {})
    const leaveSecond = subscribeToUser(5, () => {})
    expect(client.private).toHaveBeenCalledTimes(1)
    leaveFirst()
    expect(client.leave).not.toHaveBeenCalled()
    leaveSecond()
    expect(client.leave).toHaveBeenCalledTimes(1)
  })

  it('keeps the user channel open until its last subscriber leaves', () => {
    const { client } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const leaveFirst = subscribeToUser(5, () => {})
    const leaveSecond = subscribeToUser(5, () => {})
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
    const leaveA = subscribeToChannel(3, 7, (message) => dropped.push(message.id))
    subscribeToChannel(3, 8, () => {})
    subscribeToChannel(30, 7, (message) => kept.push(message.id))
    subscribeToUser(3, () => {})

    leaveOrganization(3)

    expect(client.leave).toHaveBeenCalledTimes(2)
    expect(client.leave).toHaveBeenCalledWith('organizations.3.channels.7')
    expect(client.leave).toHaveBeenCalledWith('organizations.3.channels.8')
    listeners.get(`organizations.3.channels.7|${MESSAGE_CREATED_EVENT}`)?.({ message: { id: 1 } as Message })
    listeners.get(`organizations.30.channels.7|${MESSAGE_CREATED_EVENT}`)?.({ message: { id: 2 } as Message })
    expect(dropped).toEqual([])
    expect(kept).toEqual([2])

    leaveA()
    expect(client.leave).toHaveBeenCalledTimes(2)
  })

  it('delivers nothing and leaves nothing after disconnectRealtime', () => {
    const { client } = createFakeRealtimeClient()
    setRealtimeClientFactory(() => client)
    const leave = subscribeToUser(5, () => {})
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

  it('does nothing without a client (no Reverb key)', () => {
    setRealtimeClientFactory(() => null)
    expect(() => subscribeToChannel(1, 1, () => {})()).not.toThrow()
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
