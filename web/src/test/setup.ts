import { beforeEach } from 'vitest'
import { setRealtimeClientFactory } from '../realtime/echo'

beforeEach(() => {
  setRealtimeClientFactory(() => null)
})
