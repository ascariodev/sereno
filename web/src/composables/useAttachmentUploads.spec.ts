import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import * as attachmentsApi from '../api/attachments'
import { ApiError } from '../api/client'
import type { MessageAttachment } from '../api/types'
import { ATTACHMENT_MAX_SIZE_BYTES } from '../config'
import { i18n } from '../i18n'
import { useAttachmentUploads } from './useAttachmentUploads'

const attachment = (id: number): MessageAttachment => ({
  id,
  original_name: `f${id}`,
  mime: 'text/plain',
  size: 1,
  created_at: '',
  url: '',
})
const file = (name: string, size = 10) => {
  const f = new File(['x'], name)
  Object.defineProperty(f, 'size', { value: size })
  return f
}

interface Pending {
  file: File
  signal: AbortSignal | undefined
  resolve: (value: MessageAttachment) => void
  reject: (error: unknown) => void
}

let pending: Pending[]
let state: ReturnType<typeof useAttachmentUploads>
let channel = ref(5)
let wrapper: VueWrapper

function mountComposable(): void {
  wrapper = mount(
    defineComponent({
      setup() {
        state = useAttachmentUploads(() => channel.value)
        return () => h('div')
      },
    }),
  )
}

beforeEach(() => {
  pending = []
  channel = ref(5)
  i18n.global.locale.value = 'en'
  vi.spyOn(attachmentsApi, 'uploadAttachment').mockImplementation(
    (_id, f, options) =>
      new Promise((resolve, reject) => {
        pending.push({ file: f, signal: options?.signal, resolve, reject })
      }),
  )
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})

describe('useAttachmentUploads', () => {
  it('uploads, marks ready and keeps ids in selection order', async () => {
    mountComposable()
    state.add([file('a'), file('b')])
    expect(state.busy.value).toBe(true)
    expect(state.items.value.map((i) => i.status)).toEqual(['uploading', 'uploading'])
    pending[1]!.resolve(attachment(2))
    pending[0]!.resolve(attachment(1))
    await flushPromises()
    expect(state.busy.value).toBe(false)
    expect(state.attachmentIds.value).toEqual([1, 2])
  })

  it('rejects oversized files and files over the limit before uploading', () => {
    mountComposable()
    state.add([file('big', ATTACHMENT_MAX_SIZE_BYTES + 1)])
    expect(pending).toHaveLength(0)
    expect(state.items.value[0]).toMatchObject({ status: 'error', retryable: false })
    expect(state.items.value[0]!.error).toContain('5 MB')

    state.add(Array.from({ length: 12 }, (_, i) => file(`n${i}`)))
    expect(pending).toHaveLength(10)
    expect(state.full.value).toBe(true)
    expect(state.items.value.filter((i) => i.status === 'error')).toHaveLength(3)
    expect(state.items.value[11]!.error).toContain('10')
  })

  it('cancels with an abort signal and discards a late response', async () => {
    mountComposable()
    state.add([file('a')])
    const key = state.items.value[0]!.key
    state.remove(key)
    expect(pending[0]!.signal?.aborted).toBe(true)
    expect(state.items.value).toEqual([])
    pending[0]!.resolve(attachment(1))
    await flushPromises()
    expect(state.items.value).toEqual([])
    expect(state.attachmentIds.value).toEqual([])
  })

  it('removes a ready attachment', async () => {
    mountComposable()
    state.add([file('a'), file('b')])
    pending[0]!.resolve(attachment(1))
    pending[1]!.resolve(attachment(2))
    await flushPromises()
    state.remove(state.items.value[0]!.key)
    expect(state.attachmentIds.value).toEqual([2])
  })

  it('shows a translated error and retries a transient failure', async () => {
    mountComposable()
    state.add([file('a')])
    pending[0]!.reject(new ApiError(429, 'Too Many Attempts.'))
    await flushPromises()
    const item = state.items.value[0]!
    expect(item).toMatchObject({ status: 'error', retryable: true })
    expect(item.error).toBe('You are uploading too fast. Try again in a moment.')
    state.retry(item.key)
    expect(state.items.value[0]!.status).toBe('uploading')
    pending[1]!.resolve(attachment(9))
    await flushPromises()
    expect(state.attachmentIds.value).toEqual([9])
  })

  it('uses the server message on 422 and does not allow retry', async () => {
    mountComposable()
    state.add([file('a')])
    pending[0]!.reject(new ApiError(422, 'invalid', { file: ['The file is empty.'] }))
    await flushPromises()
    expect(state.items.value[0]).toMatchObject({ error: 'The file is empty.', retryable: false })
    state.retry(state.items.value[0]!.key)
    expect(pending).toHaveLength(1)
  })

  it('falls back to a generic error', async () => {
    mountComposable()
    state.add([file('a')])
    pending[0]!.reject(new ApiError(500, 'boom'))
    await flushPromises()
    expect(state.items.value[0]!.error).toBe('Could not upload the file.')
  })

  it('reset aborts everything and drops late responses', async () => {
    mountComposable()
    state.add([file('a')])
    state.reset()
    expect(pending[0]!.signal?.aborted).toBe(true)
    pending[0]!.resolve(attachment(1))
    await flushPromises()
    expect(state.items.value).toEqual([])
    expect(state.busy.value).toBe(false)
  })

  it('aborts on channel change', async () => {
    mountComposable()
    state.add([file('a')])
    channel.value = 6
    await flushPromises()
    expect(pending[0]!.signal?.aborted).toBe(true)
    expect(state.items.value).toEqual([])
  })

  it('aborts on unmount', () => {
    mountComposable()
    state.add([file('a')])
    wrapper.unmount()
    expect(pending[0]!.signal?.aborted).toBe(true)
  })
})
