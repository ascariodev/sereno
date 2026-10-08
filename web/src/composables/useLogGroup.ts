import { onUnmounted, ref, watch } from 'vue'
import { ApiError } from '../api/client'
import { getLogGroup } from '../api/logGroups'
import type { LogGroup, LogGroupStatus } from '../api/types'

export type LogGroupLoadError = 'failed' | 'notFound'

export function useLogGroup(
  projectId: () => number,
  groupId: () => number,
  refreshToken: () => number | undefined,
) {
  const group = ref<LogGroup | null>(null)
  const loading = ref(false)
  const loadError = ref<LogGroupLoadError | null>(null)
  let generation = 0
  let controller: AbortController | null = null

  async function load(reset: boolean): Promise<void> {
    const current = ++generation
    controller?.abort()
    controller = new AbortController()
    if (reset) {
      group.value = null
      loading.value = true
    }
    loadError.value = null
    try {
      const loaded = await getLogGroup(projectId(), groupId(), controller.signal)
      if (current !== generation) return
      group.value = loaded
    } catch (caught) {
      if (current !== generation) return
      if (reset) group.value = null
      loadError.value = caught instanceof ApiError && caught.status === 404 ? 'notFound' : 'failed'
    } finally {
      if (current === generation) loading.value = false
    }
  }

  watch(
    () => [projectId(), groupId()] as const,
    () => void load(true),
    { immediate: true },
  )
  watch(refreshToken, () => void load(false))

  onUnmounted(() => {
    generation++
    controller?.abort()
  })

  function setStatus(status: LogGroupStatus): void {
    if (group.value) group.value = { ...group.value, status }
  }

  return { group, loading, loadError, setStatus }
}
