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
})
