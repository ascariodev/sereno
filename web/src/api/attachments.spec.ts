import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadAttachment } from './attachments'
import { ApiError } from './client'

function stubFetch(body: unknown, status = 201) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('attachments api', () => {
  it('posts the file as multipart in the file field and unwraps the attachment', async () => {
    const attachment = { id: 3, original_name: 'a.txt', mime: 'text/plain', size: 1, created_at: 'x', url: 'u' }
    const fetchMock = stubFetch({ data: attachment })
    const file = new File(['a'], 'a.txt', { type: 'text/plain' })

    const result = await uploadAttachment(5, file)

    expect(result).toEqual(attachment)
    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url, 'http://x').pathname).toBe('/api/channels/5/attachments')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).get('file')).toBeInstanceOf(File)
    expect(init?.headers).not.toHaveProperty('Content-Type')
  })

  it('passes the abort signal to fetch', async () => {
    const fetchMock = stubFetch({ data: {} })
    const controller = new AbortController()
    await uploadAttachment(5, new File(['a'], 'a.txt'), { signal: controller.signal })
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal)
  })

  it('rejects with the AbortError when aborted', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort()
        throw new DOMException('Aborted', 'AbortError')
      }),
    )
    await expect(uploadAttachment(5, new File(['a'], 'a.txt'), { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('exposes the 422 field errors', async () => {
    stubFetch({ message: 'bad', errors: { file: ['too big'] } }, 422)
    const error = await uploadAttachment(5, new File(['a'], 'a.txt')).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.errors).toEqual({ file: ['too big'] })
  })
})
