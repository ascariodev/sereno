import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { TaskComment } from '../api/types'
import { i18n } from '../i18n'
import { useTaskCommentsStore } from '../stores/taskComments'
import TaskCommentEditor from './TaskCommentEditor.vue'

enableAutoUnmount(afterEach)

const attachment = (id: number, name: string) =>
  ({ id, original_name: name, mime: 'text/plain', size: 10, created_at: '2026-10-12T09:00:00Z', url: `http://api/${id}` })

const base: TaskComment = {
  id: 7,
  task_id: 9,
  body: 'Hi <@3>',
  user: { id: 1, name: 'Ana' },
  mentions: [{ id: 3, name: 'Carla' }],
  attachments: [],
  created_at: '2026-10-12T09:00:00Z',
  edited_at: null,
}

function mountEditor(overrides: Partial<TaskComment> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const comment = { ...base, ...overrides }
  const store = useTaskCommentsStore()
  store.$patch({ taskId: 9, projectId: 5, comments: [comment] })
  const wrapper = mount(TaskCommentEditor, {
    props: { projectId: 5, taskId: 9, comment, mentions: { members: [], excludeUserId: 1 } },
    global: { plugins: [pinia, i18n] },
    attachTo: document.body,
  })
  return { wrapper, store }
}

describe('TaskCommentEditor', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows mentions by name and keeps their tokens in the saved body', async () => {
    const edited = { ...base, body: 'Hi <@3> again', edited_at: '2026-10-12T10:00:00Z' }
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: edited } as never)
    const { wrapper, store } = mountEditor()
    const field = wrapper.get('textarea')
    expect((field.element as HTMLTextAreaElement).value).toBe('Hi @Carla')
    expect(wrapper.get('[data-test="edit-save"]').attributes('disabled')).toBeDefined()

    await field.setValue('Hi @Carla again')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/api/projects/5/tasks/9/comments/7', { body: 'Hi <@3> again' })
    expect(store.comments[0].body).toBe('Hi <@3> again')
    expect(wrapper.emitted('done')).toHaveLength(1)
  })

  it('focuses the field on mount with the caret at the end', () => {
    const { wrapper } = mountEditor()
    const field = wrapper.get('textarea').element as HTMLTextAreaElement
    expect(document.activeElement).toBe(field)
    expect(field.selectionStart).toBe(field.value.length)
  })

  it('treats whitespace-only changes as unchanged', async () => {
    const { wrapper } = mountEditor()
    await wrapper.get('textarea').setValue('Hi @Carla  ')
    expect(wrapper.get('[data-test="edit-save"]').attributes('disabled')).toBeDefined()
  })

  it('only sends removals of attachments the comment still has', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: { ...base, edited_at: '2026-10-12T10:00:00Z' } } as never)
    const { wrapper } = mountEditor({ attachments: [attachment(4, 'a.txt'), attachment(5, 'b.txt')] })
    const toggles = wrapper.findAll('[data-test="edit-attachment-toggle"]')
    await toggles[0].trigger('click')
    await toggles[1].trigger('click')
    await wrapper.setProps({ comment: { ...base, attachments: [attachment(5, 'b.txt')] } })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/api/projects/5/tasks/9/comments/7', { body: 'Hi <@3>', remove_attachment_ids: [5] })
  })

  it('disables saving with an empty body', async () => {
    const { wrapper } = mountEditor()
    await wrapper.get('textarea').setValue('   ')
    expect(wrapper.get('[data-test="edit-save"]').attributes('disabled')).toBeDefined()
  })

  it('sends the attachments marked for removal and lets them be kept again', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: { ...base, edited_at: '2026-10-12T10:00:00Z' } } as never)
    const { wrapper } = mountEditor({ attachments: [attachment(4, 'a.txt'), attachment(5, 'b.txt')] })
    const toggles = () => wrapper.findAll('[data-test="edit-attachment-toggle"]')
    await toggles()[0].trigger('click')
    await toggles()[1].trigger('click')
    await toggles()[1].trigger('click')
    expect(toggles()[0].text()).toBe('Keep')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/api/projects/5/tasks/9/comments/7', { body: 'Hi <@3>', remove_attachment_ids: [4] })
  })

  it('cancels with the button and with Escape without saving', async () => {
    const patch = vi.spyOn(api, 'patch')
    const { wrapper } = mountEditor()
    await wrapper.get('textarea').setValue('changed')
    await wrapper.get('[data-test="edit-cancel"]').trigger('click')
    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('done')).toHaveLength(2)
    expect(patch).not.toHaveBeenCalled()
  })

  it.each([
    [new ApiError(422, 'Invalid', { body: ['The body is too long.'] }), 'The body is too long.'],
    [new ApiError(0, 'offline'), 'Could not reach the server.'],
    [new ApiError(403, 'no'), 'You cannot edit this comment.'],
    [new ApiError(404, 'gone'), 'The comment no longer exists.'],
    [new ApiError(500, 'boom'), 'Could not save the changes.'],
  ])('shows the error and stays open (%s)', async (error, text) => {
    vi.spyOn(api, 'patch').mockRejectedValue(error)
    const { wrapper } = mountEditor()
    await wrapper.get('textarea').setValue('Hi @Carla, ok')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-test="edit-error"]').text()).toBe(text)
    expect(wrapper.emitted('done')).toBeUndefined()
    expect(wrapper.get('[data-test="edit-save"]').attributes('disabled')).toBeUndefined()
  })
})
