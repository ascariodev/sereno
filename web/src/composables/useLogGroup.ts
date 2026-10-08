import { onUnmounted, ref, watch } from 'vue'
import { ApiError } from '../api/client'
import { getHourlyCounts, getLogGroup } from '../api/logGroups'
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
  const hourly = ref<number[] | null>(null)
  let generation = 0
  let controller: AbortController | null = null
  let hourlyGeneration = 0
  let hourlyController: AbortController | null = null

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

  async function loadHourly(reset: boolean): Promise<void> {
    const current = ++hourlyGeneration
    hourlyController?.abort()
    hourlyController = new AbortController()
    if (reset) hourly.value = null
    const id = groupId()
    try {
      const response = await getHourlyCounts(projectId(), [id], hourlyController.signal)
      if (current !== hourlyGeneration) return
      hourly.value = response.counts?.[String(id)] ?? null
    } catch {
      if (current === hourlyGeneration) hourly.value = null
    }
  }

  watch(
    () => [projectId(), groupId()] as const,
    () => {
      void load(true)
      void loadHourly(true)
    },
    { immediate: true },
  )
  watch(refreshToken, () => {
    void load(false)
    void loadHourly(false)
  })

  onUnmounted(() => {
    generation++
    controller?.abort()
    hourlyGeneration++
    hourlyController?.abort()
  })

  function setStatus(status: LogGroupStatus): void {
    if (group.value) group.value = { ...group.value, status }
  }

  return { group, loading, loadError, hourly, setStatus }
}
