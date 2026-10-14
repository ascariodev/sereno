import { useEffect, useRef, useState } from 'react'

import { ApiError } from '@/api/client'
import { i18n } from '@/i18n'
import {
  ATTACHMENT_MAX_PER_MESSAGE,
  ATTACHMENT_MAX_SIZE_BYTES,
  formatFileSize,
  uploadAttachment,
  type PickedFile,
} from '@/messages/attachments'
import type { MessageAttachment } from '@/messages/store'

export type UploadStatus = 'uploading' | 'ready' | 'error'

export interface UploadItem {
  key: number
  name: string
  size: number | null
  status: UploadStatus
  attachment: MessageAttachment | null
  error: string | null
  /** Only failures that may succeed on a second try (network, 429, 5xx). */
  retryable: boolean
}

interface LiveState {
  channelId: number | null
  items: UploadItem[]
  files: Map<number, PickedFile>
  controllers: Map<number, AbortController>
  nextKey: number
  // Bumped on reset: a late response from an older round is dropped.
  generation: number
}

function tooLargeText(name: string): string {
  return i18n.t('attachments.tooLarge', { name, max: formatFileSize(ATTACHMENT_MAX_SIZE_BYTES, i18n.language) })
}

function messageFor(error: unknown, file: PickedFile): { message: string; retryable: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 422) {
      const detail = error.errors.file?.[0] ?? error.errors.channel?.[0]
      return { message: detail ?? i18n.t('attachments.failed'), retryable: false }
    }
    if (error.status === 413) return { message: tooLargeText(file.name), retryable: false }
    if (error.status === 429) return { message: i18n.t('attachments.rateLimited'), retryable: true }
    return { message: i18n.t('attachments.failed'), retryable: error.status >= 500 }
  }
  return { message: i18n.t('attachments.failed'), retryable: true }
}

/** Uploads picked files to the channel before sending; a channel change or unmount drops them all. */
export function useAttachmentUploads(channelId: number | null) {
  const [items, setItems] = useState<UploadItem[]>([])
  const live = useRef<LiveState>({ channelId, items: [], files: new Map(), controllers: new Map(), nextKey: 1, generation: 0 })

  function commit(next: UploadItem[]) {
    live.current.items = next
    setItems(next)
  }

  function patch(key: number, change: Partial<UploadItem>) {
    commit(live.current.items.map((item) => (item.key === key ? { ...item, ...change } : item)))
  }

  function activeCount(): number {
    return live.current.items.filter((item) => item.status !== 'error').length
  }

  async function start(key: number, destination: number) {
    const state = live.current
    const file = state.files.get(key)
    if (!file) return
    const round = state.generation
    const controller = new AbortController()
    state.controllers.set(key, controller)
    try {
      const attachment = await uploadAttachment(destination, file, { signal: controller.signal })
      if (round !== state.generation || controller.signal.aborted) return
      if (!state.items.some((item) => item.key === key)) return
      state.files.delete(key)
      patch(key, { status: 'ready', attachment, error: null })
    } catch (error) {
      if (round !== state.generation || controller.signal.aborted) return
      if (!state.items.some((item) => item.key === key)) return
      const { message, retryable } = messageFor(error, file)
      patch(key, { status: 'error', error: message, retryable })
    } finally {
      if (state.controllers.get(key) === controller) state.controllers.delete(key)
    }
  }

  /** Files picked for a channel the composer already left are dropped. */
  function add(selected: PickedFile[]) {
    const state = live.current
    if (channelId === null || state.channelId !== channelId) return
    for (const file of selected) {
      const key = state.nextKey++
      const base = { key, name: file.name, size: file.size, attachment: null, retryable: false }
      if (file.size !== null && file.size > ATTACHMENT_MAX_SIZE_BYTES) {
        commit([...state.items, { ...base, status: 'error', error: tooLargeText(file.name) }])
        continue
      }
      if (activeCount() >= ATTACHMENT_MAX_PER_MESSAGE) {
        const error = i18n.t('attachments.tooMany', { max: ATTACHMENT_MAX_PER_MESSAGE })
        commit([...state.items, { ...base, status: 'error', error }])
        continue
      }
      state.files.set(key, file)
      commit([...state.items, { ...base, status: 'uploading', error: null }])
      void start(key, channelId)
    }
  }

  function retry(key: number) {
    const state = live.current
    const item = state.items.find((entry) => entry.key === key)
    if (channelId === null || !item || item.status !== 'error' || !item.retryable || !state.files.has(key)) return
    if (activeCount() >= ATTACHMENT_MAX_PER_MESSAGE) {
      patch(key, { error: i18n.t('attachments.tooMany', { max: ATTACHMENT_MAX_PER_MESSAGE }), retryable: false })
      return
    }
    patch(key, { status: 'uploading', error: null, retryable: false })
    void start(key, channelId)
  }

  /** Cancels an upload in progress or drops a finished or failed one. */
  function remove(key: number) {
    const state = live.current
    state.controllers.get(key)?.abort()
    state.controllers.delete(key)
    state.files.delete(key)
    commit(state.items.filter((item) => item.key !== key))
  }

  /** After a send: drops the sent attachments and the failed items, keeps uploads that started meanwhile. */
  function discardSent(sentIds: number[]) {
    for (const item of live.current.items) {
      if (item.status === 'error' || (item.attachment !== null && sentIds.includes(item.attachment.id))) remove(item.key)
    }
  }

  useEffect(() => {
    const state = live.current
    state.channelId = channelId
    return () => {
      state.channelId = null
      state.generation++
      for (const controller of state.controllers.values()) controller.abort()
      state.controllers.clear()
      state.files.clear()
      state.items = []
      setItems([])
    }
  }, [channelId])

  const attachmentIds = items.flatMap((item) => (item.status === 'ready' && item.attachment ? [item.attachment.id] : []))
  const busy = items.some((item) => item.status === 'uploading')
  const full = items.filter((item) => item.status !== 'error').length >= ATTACHMENT_MAX_PER_MESSAGE

  return { items, attachmentIds, busy, full, add, retry, remove, discardSent }
}
