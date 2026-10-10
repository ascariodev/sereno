import { ref, type Ref } from 'vue'
import { registrationStatus } from '../api/registration'

let cached: boolean | null = null
let pending: Promise<boolean> | null = null

let generation = 0

function fetchStatus(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached)
  if (pending) return pending
  const started = generation
  const request: Promise<boolean> = registrationStatus()
    .then((enabled) => {
      if (started === generation) cached = enabled
      return enabled
    })
    .catch(() => false)
    .finally(() => {
      if (pending === request) pending = null
    })
  pending = request
  return request
}

export function resetRegistrationStatus(): void {
  generation++
  cached = null
  pending = null
}

export function useRegistrationStatus(): { enabled: Ref<boolean | null>; ready: Promise<boolean> } {
  const enabled = ref<boolean | null>(cached)
  const ready = fetchStatus().then((value) => {
    enabled.value = value
    return value
  })
  return { enabled, ready }
}
