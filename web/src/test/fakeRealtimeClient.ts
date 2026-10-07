import { vi } from 'vitest'
import type { Message } from '../api/types'
import type { ConnectionStatus, RealtimeClient } from '../realtime/echo'

export function createFakeRealtimeClient() {
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
