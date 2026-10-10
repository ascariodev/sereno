import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { api, ApiError } from '../api/client'
import { i18n } from '../i18n'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useOrganizationStore } from '../stores/organization'
import { useTasksStore } from '../stores/tasks'
import TaskCreateDialog from './TaskCreateDialog.vue'

enableAutoUnmount(afterEach)

const task = { id: 9, project_id: 5, key: 'P-1', number: 1, title: 'x', description: null, status: 'todo', position: 1, created_by: 1, assignee: null, log_group: null, created_at: '', updated_at: '' }
const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)

function mountHost(props: Record<string, unknown> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useOrganizationStore().$patch({ activeId: 1 })
  useMemberDirectoryStore().$patch({ members: [{ id: 3, name: 'Bea', email: 'b@b.c', role: 'member', joined_at: null }] })
  vi.spyOn(useMemberDirectoryStore(), 'ensureLoaded').mockResolvedValue()
  const open = ref(false)
  const created = vi.fn()
  const host = defineComponent({
    render: () =>
      h('div', [
        h('button', { id: 'opener', onClick: () => (open.value = true) }, 'open'),
        h(TaskCreateDialog, { projectId: 5, ...props, open: open.value, 'onUpdate:open': (v: boolean) => (open.value = v), onCreated: created }),
      ]),
  })
  const wrapper = mount(host, { attachTo: document.body, global: { plugins: [pinia, i18n] } })
  return { wrapper, open, created }
}

async function openIt(wrapper: ReturnType<typeof mountHost>['wrapper']) {
  const button = wrapper.get('#opener')
  ;(button.element as HTMLElement).focus()
  await button.trigger('click')
  await flushPromises()
}

async function type(sel: string, value: string) {
  const el = q<HTMLInputElement>(sel)!
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function submit() {
  q<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await flushPromises()
}

describe('TaskCreateDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })
  afterEach(() => useTasksStore().clear())

  it('focuses the title, sends the form with column, prefilled title and log group, and closes', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: task } as never)
    const { wrapper, open, created } = mountHost({ status: 'in_review', initialTitle: 'Boom', logGroupId: 12 })
    await openIt(wrapper)
    expect(document.activeElement).toBe(q('#task-create-title'))
    expect(q<HTMLInputElement>('#task-create-title')!.value).toBe('Boom')
    q<HTMLSelectElement>('#task-create-assignee')!.value = '3'
    q<HTMLSelectElement>('#task-create-assignee')!.dispatchEvent(new Event('change'))
    await type('#task-create-description', '  details ')
    await submit()
    expect(post).toHaveBeenCalledWith('/api/projects/5/tasks', {
      title: 'Boom', description: 'details', status: 'in_review', assignee_id: 3, log_group_id: 12,
    })
    expect(created).toHaveBeenCalledWith(task)
    expect(open.value).toBe(false)
  })

  it('returns focus to the button that opened it', async () => {
    const { wrapper, open } = mountHost()
    await openIt(wrapper)
    expect(open.value).toBe(true)
    q<HTMLButtonElement>('[data-test=cancel]')!.click()
    await flushPromises()
    expect(open.value).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('#opener').element)
  })

  it('rejects empty and too long values counting characters, not UTF-16 units', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: task } as never)
    const { wrapper } = mountHost()
    await openIt(wrapper)
    await submit()
    expect(q('[data-test=error-title]')!.textContent).toContain('Enter a title')
    expect(q('#task-create-title')!.getAttribute('aria-invalid')).toBe('true')
    expect(q('#task-create-title')!.getAttribute('aria-describedby')).toBe('task-create-title-error-0')
    await type('#task-create-title', '😀'.repeat(200))
    await submit()
    expect(q('[data-test=error-title]')).toBeNull()
    expect(post).toHaveBeenCalledTimes(1)
    post.mockClear()
    await openIt(wrapper)
    await type('#task-create-title', '😀'.repeat(201))
    await type('#task-create-description', '😀'.repeat(10001))
    await submit()
    expect(q('[data-test=error-title]')).not.toBeNull()
    expect(q('[data-test=error-description]')).not.toBeNull()
    expect(q('#task-create-description')!.getAttribute('aria-describedby')).toBe('task-create-description-error-0')
    expect(post).not.toHaveBeenCalled()
  })

  it('shows 422 field errors linked to the field, and keeps the dialog open', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'bad', { title: ['Bad title'], assignee_id: ['Bad assignee'] }))
    const { wrapper, open } = mountHost()
    await openIt(wrapper)
    await type('#task-create-title', 'ok')
    await submit()
    expect(q('[data-test=error-title]')!.textContent).toBe('Bad title')
    expect(q('[data-test=error-assignee]')!.textContent).toBe('Bad assignee')
    expect(q('#task-create-assignee')!.getAttribute('aria-describedby')).toBe('task-create-assignee_id-error-0')
    expect(q('[data-test=error-form]')).toBeNull()
    expect(open.value).toBe(true)
  })

  it('shows the message of a 422 without a known field, and a generic 429', async () => {
    const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(422, 'Project archived', { log_group_id: ['taken'] }))
    const { wrapper } = mountHost()
    await openIt(wrapper)
    await type('#task-create-title', 'ok')
    await submit()
    expect(q('[data-test=error-form]')!.textContent).toBe('Project archived')
    post.mockRejectedValueOnce(new ApiError(429, 'Too Many Attempts.'))
    await submit()
    expect(q('[data-test=error-form]')!.textContent).toContain('Too many attempts')
    expect(q('[data-test=error-title]')).toBeNull()
  })

  it('emits groupTaken and closes on the 422 of a log group that already has a task', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'taken', { log_group_id: ['taken'] }))
    const taken = vi.fn()
    const { wrapper, open } = mountHost({ logGroupId: 4, onGroupTaken: taken })
    await openIt(wrapper)
    await type('#task-create-title', 'ok')
    await submit()
    expect(taken).toHaveBeenCalledTimes(1)
    expect(open.value).toBe(false)
  })

  it('reopens clean after a cancel', async () => {
    const { wrapper, open } = mountHost({ initialTitle: 'Seed' })
    await openIt(wrapper)
    await type('#task-create-title', 'changed')
    open.value = false
    await flushPromises()
    await openIt(wrapper)
    expect(q<HTMLInputElement>('#task-create-title')!.value).toBe('Seed')
  })
})
