import { ref, type Ref } from 'vue'
import { registrationStatus } from '../api/registration'

let cached: boolean | null = null
let pending: Promise<boolean | null> | null = null

let generation = 0

function fetchStatus(): Promise<boolean | null> {
  if (cached !== null) return Promise.resolve(cached)
  if (pending) return pending
  const started = generation
  const request: Promise<boolean | null> = registrationStatus()
    .then((enabled) => {
      if (started === generation) cached = enabled
      return enabled
    })
    .catch(() => null)
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

export function useRegistrationStatus(): {
  enabled: Ref<boolean | null>
  failed: Ref<boolean>
  ready: Promise<boolean | null>
  retry: () => Promise<boolean | null>
} {
  const enabled = ref<boolean | null>(cached)
  const failed = ref(false)
  const load = () =>
    fetchStatus().then((value) => {
      enabled.value = value
      failed.value = value === null
      return value
    })
  const retry = () => {
    enabled.value = null
    failed.value = false
    return load()
  }
  return { enabled, failed, ready: load(), retry }
}
