import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../api/types'
import { config } from '../config'
import {
  createAuthorizer,
  disconnectRealtime,
  MESSAGE_CREATED_EVENT,
  type ConnectionStatus,
  onReconnect,
  type RealtimeClient,
  setRealtimeClientFactory,
  setRealtimeTokenProvider,
  subscribeToChannel,
} from './echo'

function fakeClient() {
  const listeners = new Map<string, (data: { message: Message }) => void>()
  let status: ConnectionStatus = 'connecting'
  const statusListeners = new Set<(next: ConnectionStatus) => void>()
  const client = {
    private: vi.fn((name: string) => ({
      listen: vi.fn((event: string, callback: (data: { message: Message }) => void) => {
        listeners.set(`${name}|${event}`, callback)
      }),
    })),
    leave: vi.fn(),
    disconnect: vi.fn(),
    connectionStatus: vi.fn((): ConnectionStatus => status),
    onConnectionChange: vi.fn((callback: (next: ConnectionStatus) => void) => {
      statusListeners.add(callback)
      return () => statusListeners.delete(callback)
    }),
  } satisfies RealtimeClient
  const setStatus = (next: ConnectionStatus) => {
    status = next
    statusListeners.forEach((listener) => listener(next))
  }
  return { client, listeners, setStatus, statusListeners }
}

describe('realtime', () => {
  afterEach(() => {
    setRealtimeClientFactory(null)
    setRealtimeTokenProvider(() => null)
  })

  it('subscribes to the private channel and forwards message.created', () => {
    const { client, listeners } = fakeClient()
    setRealtimeClientFactory(() => client)
    const received: Message[] = []
    const leave = subscribeToChannel(3, 7, (message) => received.push(message))

    expect(client.private).toHaveBeenCalledWith('organizations.3.channels.7')
    listeners.get(`organizations.3.channels.7|${MESSAGE_CREATED_EVENT}`)?.({ message: { id: 9 } as Message })
    expect(received.map((message) => message.id)).toEqual([9])

    leave()
    expect(client.leave).toHaveBeenCalledWith('organizations.3.channels.7')
  })

  it('reuses one client and creates a new one after disconnect', () => {
    const factory = vi.fn(() => fakeClient().client)
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
    const { client, setStatus, statusListeners } = fakeClient()
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
    const { client, setStatus } = fakeClient()
    setRealtimeClientFactory(() => client)
    const callback = vi.fn()
    onReconnect(callback)
    setStatus('failed')
    setStatus('connected')
    expect(callback).not.toHaveBeenCalled()
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
