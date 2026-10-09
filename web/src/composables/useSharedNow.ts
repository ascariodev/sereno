import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'

const TICK_MS = 60_000

const now = ref(Date.now())
let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null

export function useSharedNow(): Ref<number> {
  if (getCurrentScope()) {
    if (subscribers++ === 0) {
      now.value = Date.now()
      timer = setInterval(() => {
        now.value = Date.now()
      }, TICK_MS)
    }
    onScopeDispose(() => {
      if (--subscribers === 0 && timer !== null) {
        clearInterval(timer)
        timer = null
      }
    })
  }
  return now
}
