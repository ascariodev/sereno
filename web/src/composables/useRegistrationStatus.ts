import { ref, type Ref } from 'vue'
import { registrationStatus } from '../api/registration'

let cached: boolean | null = null
let pending: Promise<boolean> | null = null

function fetchStatus(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached)
  pending ??= registrationStatus()
    .then((enabled) => {
      cached = enabled
      return enabled
    })
    .catch(() => false)
    .finally(() => {
      pending = null
    })
  return pending
}

export function resetRegistrationStatus(): void {
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
