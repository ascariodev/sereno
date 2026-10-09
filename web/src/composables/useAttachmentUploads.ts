import { computed, onScopeDispose, ref, watch } from 'vue'
import { uploadAttachment } from '../api/attachments'
import { ApiError } from '../api/client'
import type { MessageAttachment } from '../api/types'
import { ATTACHMENT_MAX_PER_MESSAGE, ATTACHMENT_MAX_SIZE_BYTES } from '../config'
import { formatFileSize } from '../formatFileSize'
import { i18n } from '../i18n'

export type UploadStatus = 'uploading' | 'ready' | 'error'

export interface UploadItem {
  /** Local id, unique per composable instance. */
  key: number
  name: string
  size: number
  status: UploadStatus
  attachment: MessageAttachment | null
  /** Translated message when `status` is `error`. */
  error: string | null
  /** Only failures that may succeed on a second try (network, 429, 5xx). */
  retryable: boolean
}

const t = (key: string, params: Record<string, unknown> = {}): string =>
  i18n.global.t(key, params) as string

export function useAttachmentUploads(
  channelId: () => number,
  options: { maxFiles?: number; maxBytes?: number } = {},
) {
  const maxFiles = options.maxFiles ?? ATTACHMENT_MAX_PER_MESSAGE
  const maxBytes = options.maxBytes ?? ATTACHMENT_MAX_SIZE_BYTES

  const items = ref<UploadItem[]>([])
  const files = new Map<number, File>()
  const controllers = new Map<number, AbortController>()
  let nextKey = 1
  // Bumped by reset and channel changes: a late response from an older round is dropped (L-10, L-32).
  let generation = 0

  const busy = computed(() => items.value.some((item) => item.status === 'uploading'))
  const attachmentIds = computed(() =>
    items.value.flatMap((item) => (item.status === 'ready' && item.attachment ? [item.attachment.id] : [])),
  )
  const attachments = computed(() =>
    items.value.flatMap((item) => (item.status === 'ready' && item.attachment ? [item.attachment] : [])),
  )
  const activeCount = () => items.value.filter((item) => item.status !== 'error').length
  const full = computed(() => activeCount() >= maxFiles)

  function find(key: number): UploadItem | undefined {
    return items.value.find((item) => item.key === key)
  }

  function rejected(file: File, message: string): UploadItem {
    return {
      key: nextKey++,
      name: file.name,
      size: file.size,
      status: 'error',
      attachment: null,
      error: message,
      retryable: false,
    }
  }

  function messageFor(error: unknown, file: File | undefined): { message: string; retryable: boolean } {
    if (error instanceof ApiError) {
      if (error.status === 422) {
        const detail = error.errors.file?.[0] ?? error.errors.channel?.[0]
        return { message: detail ?? t('attachments.failed'), retryable: false }
      }
      if (error.status === 413) {
        const message = file
          ? t('attachments.tooLarge', { name: file.name, max: formatFileSize(maxBytes) })
          : t('attachments.failed')
        return { message, retryable: false }
      }
      if (error.status === 429) return { message: t('attachments.rateLimited'), retryable: true }
      return { message: t('attachments.failed'), retryable: error.status >= 500 }
    }
    return { message: t('attachments.failed'), retryable: true }
  }

  async function start(key: number): Promise<void> {
    const file = files.get(key)
    if (!file) return
    const round = generation
    const controller = new AbortController()
    controllers.set(key, controller)
    try {
      const attachment = await uploadAttachment(channelId(), file, { signal: controller.signal })
      if (round !== generation || controller.signal.aborted) return
      const item = find(key)
      if (!item) return
      item.status = 'ready'
      item.attachment = attachment
      item.error = null
      files.delete(key)
    } catch (error) {
      if (round !== generation || controller.signal.aborted) return
      const item = find(key)
      if (!item) return
      const { message, retryable } = messageFor(error, file)
      item.status = 'error'
      item.error = message
      item.retryable = retryable
    } finally {
      if (controllers.get(key) === controller) controllers.delete(key)
    }
  }

  function add(selected: Iterable<File>): void {
    for (const file of selected) {
      if (file.size > maxBytes) {
        items.value.push(rejected(file, t('attachments.tooLarge', { name: file.name, max: formatFileSize(maxBytes) })))
        continue
      }
      if (activeCount() >= maxFiles) {
        items.value.push(rejected(file, t('attachments.tooMany', { max: maxFiles })))
        continue
      }
      const key = nextKey++
      files.set(key, file)
      items.value.push({
        key,
        name: file.name,
        size: file.size,
        status: 'uploading',
        attachment: null,
        error: null,
        retryable: false,
      })
      void start(key)
    }
  }

  function retry(key: number): void {
    const item = find(key)
    if (!item || item.status !== 'error' || !item.retryable || !files.has(key)) return
    if (activeCount() >= maxFiles) {
      item.error = t('attachments.tooMany', { max: maxFiles })
      item.retryable = false
      return
    }
    item.status = 'uploading'
    item.error = null
    item.retryable = false
    void start(key)
  }

  /** Cancels an upload in progress or drops a finished/failed one; a late response is discarded. */
  function remove(key: number): void {
    controllers.get(key)?.abort()
    controllers.delete(key)
    files.delete(key)
    items.value = items.value.filter((item) => item.key !== key)
  }

  function reset(): void {
    generation++
    for (const controller of controllers.values()) controller.abort()
    controllers.clear()
    files.clear()
    items.value = []
  }

  watch(channelId, reset, { flush: 'sync' })
  onScopeDispose(reset)

  return {
    items,
    attachments,
    attachmentIds,
    busy,
    full,
    maxFiles,
    maxBytes,
    add,
    retry,
    remove,
    cancel: remove,
    reset,
  }
}
