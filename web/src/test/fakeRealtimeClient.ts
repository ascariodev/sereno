import { vi } from 'vitest'
import type { ConnectionStatus, RealtimeClient, RealtimePayload, SubscriptionErrorPayload } from '../realtime/echo'

export function createFakeRealtimeClient() {
  const listeners = new Map<string, (data: RealtimePayload) => void>()
  const errorHandlers = new Map<string, (payload: SubscriptionErrorPayload) => void>()
  let status: ConnectionStatus = 'connecting'
  const statusListeners = new Set<(next: ConnectionStatus) => void>()
  const client = {
    private: vi.fn((name: string) => ({
      listen: vi.fn((event: string, callback: (data: RealtimePayload) => void) => {
        listeners.set(`${name}|${event}`, callback)
      }),
      error: vi.fn((callback: (payload: SubscriptionErrorPayload) => void) => {
        errorHandlers.set(name, callback)
      }),
    })),
    join: vi.fn((_name: string) => ({})),
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
  const rejectChannel = (name: string, payload: SubscriptionErrorPayload) => errorHandlers.get(name)?.(payload)
  return { client, listeners, setStatus, statusListeners, rejectChannel }
}
