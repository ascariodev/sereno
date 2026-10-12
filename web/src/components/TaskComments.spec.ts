import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { TaskComment } from '../api/types'
import { i18n } from '../i18n'
import { useAuthStore } from '../stores/auth'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useTaskCommentsStore } from '../stores/taskComments'
import TaskComments from './TaskComments.vue'

enableAutoUnmount(afterEach)

const comment = (id: number, overrides: Partial<TaskComment> = {}): TaskComment => ({
  id,
  task_id: 9,
  body: `body ${id}`,
  user: { id: 2, name: 'Bea' },
  mentions: [],
  attachments: [],
  created_at: new Date().toISOString(),
  ...overrides,
})
const page = (data: TaskComment[], nextCursor: string | null = null) => ({ data, meta: { next_cursor: nextCursor } }) as never

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

function mountComments(props: { projectId?: number; taskId?: number } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().$patch({ user: { id: 1, name: 'Ana' } as never })
  useMemberDirectoryStore().$patch({
    entries: { 5: { members: [{ id: 3, name: 'Carla', email: 'c@c.c', role: 'member', joined_at: null }], loaded: true, loadedAt: Date.now(), generation: 0, inFlight: null } },
  })
  vi.spyOn(useMemberDirectoryStore(), 'ensureLoaded').mockResolvedValue()
  return mount(TaskComments, { props: { projectId: 5, taskId: 9, ...props }, global: { plugins: [pinia, i18n] } })
}

async function write(wrapper: ReturnType<typeof mountComments>, value: string) {
  await wrapper.get('textarea').setValue(value)
}

describe('TaskComments', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows loading and then the comments oldest first with author and time', async () => {
    const pending = deferred<never>()
    vi.spyOn(api, 'get').mockReturnValue(pending.promise)
    const wrapper = mountComments()
    expect(wrapper.find('[data-test="comments-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="comments-empty"]').exists()).toBe(false)
    pending.resolve(page([comment(2), comment(1, { user: null })]))
    await flushPromises()
    expect(wrapper.find('[data-test="comments-loading"]').exists()).toBe(false)
    const items = wrapper.findAll('[data-test="comment"]')
    expect(items.map((item) => item.get('[data-test="comment-author"]').text())).toEqual(['deleted user', 'Bea'])
    expect(items[1].text()).toContain('body 2')
    expect(items[1].find('time').text()).not.toBe('')
  })

  it('shows the empty state', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([]))
    const wrapper = mountComments()
    await flushPromises()
    expect(wrapper.find('[data-test="comments-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="load-older"]').exists()).toBe(false)
  })

  it('shows an error with retry and loads on retry', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(500, 'boom')).mockResolvedValueOnce(page([comment(1)]))
    const wrapper = mountComments()
    await flushPromises()
    expect(wrapper.find('[data-test="comments-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="comments-empty"]').exists()).toBe(false)
    await wrapper.get('[data-test="comments-retry"]').trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-test="comments-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="comment"]')).toHaveLength(1)
  })

  it('loads earlier comments and hides the button when there are no more', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce(page([comment(5)], 'cur')).mockResolvedValueOnce(page([comment(4)]))
    const wrapper = mountComments()
    await flushPromises()
    await wrapper.get('[data-test="load-older"]').trigger('click')
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith(
      '/api/projects/5/tasks/9/comments',
      expect.objectContaining({ query: expect.objectContaining({ cursor: 'cur' }) }),
    )
    expect(wrapper.findAll('[data-test="comment"]').map((item) => item.text())[0]).toContain('body 4')
    expect(wrapper.find('[data-test="load-older"]').exists()).toBe(false)
  })

  it('renders mention chips from the comment mentions', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([comment(1, { body: 'hi <@3>', mentions: [{ id: 3, name: 'Carla' }] })]))
    const wrapper = mountComments()
    await flushPromises()
    expect(wrapper.get('[data-mention]').text()).toContain('Carla')
  })

  it('sends a comment, appends it and clears the draft', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([]))
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: comment(7, { body: 'Hello', user: { id: 1, name: 'Ana' } }) } as never)
    const wrapper = mountComments()
    await flushPromises()
    expect(wrapper.get<HTMLButtonElement>('[data-test="comment-send"]').element.disabled).toBe(true)
    await write(wrapper, '  Hello  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/api/projects/5/tasks/9/comments', { body: 'Hello' })
    expect(wrapper.findAll('[data-test="comment"]')).toHaveLength(1)
    expect(wrapper.get('textarea').element.value).toBe('')
    expect(wrapper.find('[data-test="comment-error"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="comment-sent-status"]').text()).toBe('Comment sent.')
  })

  it('exposes status roles and names the section and list from the heading', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([]))
    const wrapper = mountComments()
    expect(wrapper.get('[data-test="comments-loading"]').attributes('role')).toBe('status')
    await flushPromises()
    expect(wrapper.get('[data-test="comments-empty"]').attributes('role')).toBe('status')
    const headingId = wrapper.get('h2').attributes('id')
    expect(wrapper.get('section').attributes('aria-labelledby')).toBe(headingId)
    expect(wrapper.get('section').attributes('aria-label')).toBeUndefined()
    vi.spyOn(api, 'get').mockResolvedValue(page([comment(1)]))
    const other = mountComments()
    await flushPromises()
    expect(other.get('ul').attributes('aria-labelledby')).toBe(other.get('h2').attributes('id'))
  })

  it('disables the composer while sending', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([]))
    const pending = deferred<never>()
    const post = vi.spyOn(api, 'post').mockReturnValue(pending.promise)
    const wrapper = mountComments()
    await flushPromises()
    await write(wrapper, 'Hello')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(post).toHaveBeenCalledTimes(1)
    expect(wrapper.get<HTMLButtonElement>('[data-test="comment-send"]').element.disabled).toBe(true)
    expect(wrapper.get('textarea').attributes('readonly')).toBeDefined()
    pending.resolve({ data: comment(7) } as never)
    await flushPromises()
    expect(wrapper.get('textarea').attributes('readonly')).toBeUndefined()
  })

  it.each([
    [new ApiError(422, 'The body field is required.', { body: ['The body field is required.'] }), 'The body field is required.'],
    [new ApiError(0, 'x'), 'Could not reach the server.'],
    [new ApiError(429, 'x'), 'Too many attempts. Try again in a minute.'],
    [new ApiError(500, 'x'), 'Could not send the comment. Try again.'],
  ])('shows the general error and keeps the draft when sending fails (%#)', async (error, message) => {
    vi.spyOn(api, 'get').mockResolvedValue(page([]))
    vi.spyOn(api, 'post').mockRejectedValue(error)
    const wrapper = mountComments()
    await flushPromises()
    await write(wrapper, 'Hello')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-test="comment-error"]').text()).toBe(message)
    expect(wrapper.get('textarea').element.value).toBe('Hello')
    expect(wrapper.get<HTMLButtonElement>('[data-test="comment-send"]').element.disabled).toBe(false)
  })

  it('shows a live comment of the open task through the store, once', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([comment(1)]))
    const wrapper = mountComments()
    await flushPromises()
    const store = useTaskCommentsStore()
    store.insert(comment(2))
    store.insert(comment(2))
    store.insert(comment(3, { task_id: 77 }))
    await flushPromises()
    expect(wrapper.findAll('[data-test="comment"]')).toHaveLength(2)
  })

  it('drops a request in flight and the draft when the task changes', async () => {
    const first = deferred<never>()
    const get = vi.spyOn(api, 'get').mockReturnValueOnce(first.promise).mockResolvedValueOnce(page([comment(20, { task_id: 10, body: 'second task' })]))
    const wrapper = mountComments()
    await write(wrapper, 'draft')
    await wrapper.setProps({ taskId: 10 })
    await flushPromises()
    first.resolve(page([comment(1, { body: 'first task' })]))
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('second task')
    expect(wrapper.text()).not.toContain('first task')
    expect(wrapper.get('textarea').element.value).toBe('')
  })

  it('does not apply the result of a send started on the previous task', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([]))
    const pending = deferred<never>()
    vi.spyOn(api, 'post').mockReturnValue(pending.promise)
    const wrapper = mountComments()
    await flushPromises()
    await write(wrapper, 'Hello')
    await wrapper.get('form').trigger('submit')
    await wrapper.setProps({ taskId: 10 })
    await flushPromises()
    pending.resolve({ data: comment(7) } as never)
    await flushPromises()
    expect(wrapper.findAll('[data-test="comment"]')).toHaveLength(0)
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.readOnly).toBe(false)
  })

  it('clears the store on unmount', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([comment(1)]))
    const wrapper = mountComments()
    await flushPromises()
    wrapper.unmount()
    expect(useTaskCommentsStore().taskId).toBeNull()
    expect(useTaskCommentsStore().comments).toEqual([])
  })

  describe('attachments', () => {
    const uploadPath = '/api/projects/5/tasks/9/attachments'
    const uploaded = (id: number, name = 'a.txt') => ({
      data: { id, original_name: name, mime: 'text/plain', size: 3, created_at: '2026-01-01T00:00:00Z', url: 'x' },
    })
    const file = (name: string, size = 3) => new File([new Uint8Array(size)], name, { type: 'text/plain' })

    async function pick(wrapper: ReturnType<typeof mountComments>, files: File[]) {
      const input = wrapper.get('[data-test="comment-picker"]')
      Object.defineProperty(input.element, 'files', { value: files, configurable: true })
      await input.trigger('change')
      await flushPromises()
    }

    it('opens the picker from the attach button and uploads to the task endpoint', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([]))
      const post = vi.spyOn(api, 'post').mockResolvedValue(uploaded(1) as never)
      const wrapper = mountComments()
      await flushPromises()
      const attach = wrapper.get('[data-test="comment-attach"]')
      expect(attach.attributes('aria-label')).toBe('Attach')
      const click = vi.spyOn(wrapper.get('[data-test="comment-picker"]').element as HTMLInputElement, 'click')
      await attach.trigger('click')
      expect(click).toHaveBeenCalled()
      await pick(wrapper, [file('a.txt')])
      expect(post).toHaveBeenCalledWith(uploadPath, expect.any(FormData), expect.anything())
      expect(wrapper.get('[data-test="comment-file"]').text()).toContain('a.txt')
    })

    it('shows the upload progress and blocks sending until it finishes', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([]))
      const upload = deferred<never>()
      vi.spyOn(api, 'post').mockReturnValue(upload.promise)
      const wrapper = mountComments()
      await flushPromises()
      await write(wrapper, 'Hello')
      await pick(wrapper, [file('a.txt')])
      expect(wrapper.get('[data-test="comment-file"]').text()).toContain('Uploading...')
      expect(wrapper.get('[data-test="comment-upload-status"]').text()).toBe('Uploading a.txt')
      expect(wrapper.get<HTMLButtonElement>('[data-test="comment-send"]').element.disabled).toBe(true)
      upload.resolve(uploaded(1) as never)
      await flushPromises()
      expect(wrapper.get<HTMLButtonElement>('[data-test="comment-send"]').element.disabled).toBe(false)
    })

    it('sends the attachment ids and clears the sent and failed files', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([]))
      const post = vi.spyOn(api, 'post').mockImplementation((url: string) => {
        if (url !== uploadPath) return Promise.resolve({ data: comment(7, { body: 'Hello' }) }) as never
        return Promise.resolve(uploaded(4)) as never
      })
      const wrapper = mountComments()
      await flushPromises()
      await pick(wrapper, [file('a.txt'), file('big.bin', 999 * 1024 * 1024)])
      expect(wrapper.findAll('[data-test="comment-file"]')).toHaveLength(2)
      await write(wrapper, 'Hello')
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(post).toHaveBeenLastCalledWith('/api/projects/5/tasks/9/comments', { body: 'Hello', attachment_ids: [4] })
      expect(wrapper.findAll('[data-test="comment-file"]')).toHaveLength(0)
    })

    it('keeps the files when sending fails', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([]))
      vi.spyOn(api, 'post').mockImplementation(
        (url: string) => (url === uploadPath ? Promise.resolve(uploaded(4)) : Promise.reject(new ApiError(500, 'x'))) as never,
      )
      const wrapper = mountComments()
      await flushPromises()
      await pick(wrapper, [file('a.txt')])
      await write(wrapper, 'Hello')
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(wrapper.findAll('[data-test="comment-file"]')).toHaveLength(1)
    })

    it('shows the error of each file and removes it', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([]))
      vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'x', { file: ['The file is empty.'] }))
      const wrapper = mountComments()
      await flushPromises()
      await pick(wrapper, [file('a.txt')])
      expect(wrapper.get('[data-test="comment-file-error"]').text()).toBe('The file is empty.')
      expect(wrapper.find('[data-test="comment-file-retry"]').exists()).toBe(false)
      expect(wrapper.get('[data-test="comment-upload-status"]').text()).toBe('Could not upload a.txt: The file is empty.')
      const remove = wrapper.get('[data-test="comment-file-remove"]')
      expect(remove.attributes('aria-label')).toBe('Remove a.txt')
      await remove.trigger('click')
      expect(wrapper.find('[data-test="comment-file"]').exists()).toBe(false)
    })

    it('offers retry on a network failure', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([]))
      const post = vi
        .spyOn(api, 'post')
        .mockRejectedValueOnce(new Error('net'))
        .mockResolvedValueOnce(uploaded(4) as never)
      const wrapper = mountComments()
      await flushPromises()
      await pick(wrapper, [file('a.txt')])
      const retry = wrapper.get('[data-test="comment-file-retry"]')
      expect(retry.attributes('aria-describedby')).toBe(wrapper.get('[data-test="comment-file-error"]').attributes('id'))
      await retry.trigger('click')
      await flushPromises()
      expect(post).toHaveBeenCalledTimes(2)
      expect(wrapper.find('[data-test="comment-file-error"]').exists()).toBe(false)
    })

    it('cancels an upload in progress', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([]))
      let signal: AbortSignal | undefined
      vi.spyOn(api, 'post').mockImplementation((_url: string, _body?: unknown, init?: { signal?: AbortSignal }) => {
        signal = init?.signal
        return new Promise(() => {}) as never
      })
      const wrapper = mountComments()
      await flushPromises()
      await pick(wrapper, [file('a.txt')])
      const cancel = wrapper.get('[data-test="comment-file-remove"]')
      expect(cancel.attributes('aria-label')).toBe('Cancel the upload of a.txt')
      await cancel.trigger('click')
      expect(signal?.aborted).toBe(true)
      expect(wrapper.find('[data-test="comment-file"]').exists()).toBe(false)
    })

    it('adds pasted and dropped files but leaves pasted text alone', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([]))
      const post = vi.spyOn(api, 'post').mockResolvedValue(uploaded(1) as never)
      const wrapper = mountComments()
      await flushPromises()
      const textPaste = new Event('paste', { cancelable: true, bubbles: true }) as Event & { clipboardData: unknown }
      textPaste.clipboardData = { files: [] }
      wrapper.get('textarea').element.dispatchEvent(textPaste)
      expect(textPaste.defaultPrevented).toBe(false)
      const filePaste = new Event('paste', { cancelable: true, bubbles: true }) as Event & { clipboardData: unknown }
      filePaste.clipboardData = { files: [file('p.png')] }
      wrapper.get('textarea').element.dispatchEvent(filePaste)
      expect(filePaste.defaultPrevented).toBe(true)
      const drop = new Event('drop', { cancelable: true, bubbles: true }) as Event & { dataTransfer: unknown }
      drop.dataTransfer = { types: ['Files'], files: [file('d.txt')] }
      wrapper.get('[data-test="comment-drop"]').element.dispatchEvent(drop)
      expect(drop.defaultPrevented).toBe(true)
      await flushPromises()
      expect(post).toHaveBeenCalledTimes(2)
      const names = wrapper.findAll('[data-test="comment-file"]').map((item) => item.text())
      expect(names[0]).toContain('p.png')
      expect(names[1]).toContain('d.txt')
    })

    it('drops the files and ignores an upload in flight when the task changes', async () => {
      vi.spyOn(api, 'get').mockResolvedValue(page([]))
      const upload = deferred<never>()
      const post = vi.spyOn(api, 'post').mockReturnValueOnce(upload.promise)
      const wrapper = mountComments()
      await flushPromises()
      await pick(wrapper, [file('a.txt')])
      await wrapper.setProps({ taskId: 10 })
      upload.resolve(uploaded(4) as never)
      await flushPromises()
      expect(wrapper.find('[data-test="comment-file"]').exists()).toBe(false)
      post.mockResolvedValue({ data: comment(8, { task_id: 10 }) } as never)
      await write(wrapper, 'Hello')
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(post).toHaveBeenLastCalledWith('/api/projects/5/tasks/10/comments', { body: 'Hello' })
    })

    it('shows the attachments of each comment and renews their url on the task endpoint', async () => {
      const image = { id: 3, original_name: 'foto.png', mime: 'image/png', size: 10, created_at: '', url: 'http://api/task-attachments/3?sig=old' }
      const get = vi.spyOn(api, 'get').mockImplementation(
        (url: string) =>
          (url === '/api/task-attachments/3/url'
            ? Promise.resolve({ data: { url: 'http://api/task-attachments/3?sig=new', expires_at: '' } })
            : Promise.resolve(page([comment(1, { attachments: [image] })]))) as never,
      )
      const wrapper = mountComments()
      await flushPromises()
      const img = wrapper.get('[data-test="comment"] img')
      expect(img.attributes('src')).toBe(image.url)
      await img.trigger('error')
      await flushPromises()
      expect(get).toHaveBeenCalledWith('/api/task-attachments/3/url')
      expect(wrapper.get('[data-test="comment"] img').attributes('src')).toBe('http://api/task-attachments/3?sig=new')
    })
  })
})
