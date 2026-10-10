import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { ApiError } from '../api/client'
import * as tasksApi from '../api/tasks'
import type { Task, TaskLogGroup } from '../api/types'
import { i18n } from '../i18n'
import { createAppRouter } from '../router'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useOrganizationStore } from '../stores/organization'
import { useTasksStore } from '../stores/tasks'
import { toast } from './ui/toast'
import TaskAside from './TaskAside.vue'

enableAutoUnmount(afterEach)

const base: Task = {
  id: 9, project_id: 5, key: 'P-1', number: 1, title: 'Fix it', description: 'Details', status: 'todo', position: 1,
  created_by: 1, assignee: null, log_group: null, created_at: '2026-01-01T00:00:00.000000Z', updated_at: '2026-01-01T00:00:00.000000Z',
}
const group: TaskLogGroup = { id: 44, level: 'error', title: 'Timeout', status: 'open', events_count: 3 }

function fakeMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })
}

async function mountAside(task: Task | null = base, props: Record<string, unknown> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useOrganizationStore().$patch({ activeId: 1 })
  useMemberDirectoryStore().$patch({ members: [{ id: 3, name: 'Bea', email: 'b@b.c', role: 'member', joined_at: null }] })
  vi.spyOn(useMemberDirectoryStore(), 'ensureLoaded').mockResolvedValue()
  const store = useTasksStore()
  store.$patch({ projectId: 5 })
  if (task) store.insert(task)
  const router = createAppRouter(createMemoryHistory())
  await router.push('/projects/5/plan')
  const wrapper = mount(TaskAside, {
    props: { projectId: 5, taskId: 9, ...props },
    attrs: { class: 'wide' },
    attachTo: document.body,
    global: { plugins: [pinia, i18n, router] },
  })
  await flushPromises()
  return { wrapper, store, router }
}

const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)
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

describe('TaskAside', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    fakeMatchMedia(false)
  })
  afterEach(() => useTasksStore().clear())

  it('fills the form and saves the three fields through the store', async () => {
    const spy = vi.spyOn(tasksApi, 'updateTask').mockResolvedValue({ ...base, title: 'New', description: null, assignee: { id: 3, name: 'Bea' }, updated_at: '2026-01-02T00:00:00.000000Z' })
    await mountAside()
    expect(q<HTMLInputElement>('#task-aside-title')!.value).toBe('Fix it')
    expect(q<HTMLButtonElement>('[data-test="submit"]')!.disabled).toBe(true)
    await type('#task-aside-title', ' New ')
    await type('#task-aside-description', '')
    const select = q<HTMLSelectElement>('#task-aside-assignee')!
    select.value = '3'
    select.dispatchEvent(new Event('change'))
    await submit()
    expect(spy).toHaveBeenCalledWith(5, 9, { title: 'New', description: null, assigneeId: 3 })
    expect(q<HTMLButtonElement>('[data-test="submit"]')!.disabled).toBe(true)
    expect(q('.task-aside')!.classList.contains('wide')).toBe(true)
  })

  it('counts title and description in characters, not UTF-16 units', async () => {
    const spy = vi.spyOn(tasksApi, 'updateTask').mockResolvedValue({ ...base, title: '😀'.repeat(200), updated_at: '2026-01-02T00:00:00.000000Z' })
    await mountAside()
    await type('#task-aside-title', '😀'.repeat(200))
    await submit()
    expect(spy).toHaveBeenCalledTimes(1)
    await type('#task-aside-title', '😀'.repeat(201))
    await submit()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(q('[data-test="error-title"]')).not.toBeNull()
    expect(q('#task-aside-title')!.getAttribute('aria-invalid')).toBe('true')
    expect(q('#task-aside-title')!.getAttribute('aria-describedby')).toBe('task-aside-title-error-0')
  })

  it('shows 422 field errors, 429 and network messages', async () => {
    const spy = vi.spyOn(tasksApi, 'updateTask').mockResolvedValue(base)
    await mountAside()
    await type('#task-aside-title', 'Other')
    spy.mockRejectedValueOnce(new ApiError(422, 'bad', { title: ['Taken'] }))
    await submit()
    expect(q('[data-test="error-title"]')!.textContent).toContain('Taken')
    spy.mockRejectedValueOnce(new ApiError(429, 'slow', {}))
    await submit()
    expect(q('[data-test="error-form"]')!.textContent).toContain('Too many attempts')
    spy.mockRejectedValueOnce(new ApiError(0, 'net', {}))
    await submit()
    expect(q('[data-test="error-form"]')!.textContent).toContain('Could not reach')
  })

  it('is read-only when the project is archived', async () => {
    const spy = vi.spyOn(tasksApi, 'updateTask').mockResolvedValue(base)
    await mountAside(base, { readOnly: true })
    expect(q('[data-test="read-only"]')).not.toBeNull()
    expect(q<HTMLInputElement>('#task-aside-title')!.readOnly).toBe(true)
    expect(q<HTMLSelectElement>('#task-aside-assignee')!.disabled).toBe(true)
    expect(q('[data-test="submit"]')).toBeNull()
    await submit()
    expect(spy).not.toHaveBeenCalled()
  })

  it('links to the origin notice panel', async () => {
    await mountAside({ ...base, log_group: group })
    const link = q<HTMLAnchorElement>('[data-test="origin-link"]')!
    expect(link.getAttribute('href')).toBe('/projects/5/log?group=44')
    expect(link.textContent).toContain('Timeout')
  })

  it('has no origin link without a notice', async () => {
    await mountAside()
    expect(q('[data-test="origin-link"]')).toBeNull()
  })

  it('closes with replace and a toast when the task is not in the store', async () => {
    const error = vi.spyOn(toast, 'error')
    const { wrapper } = await mountAside(null)
    expect(wrapper.emitted('close')).toEqual([[true]])
    expect(error).toHaveBeenCalledTimes(1)
    expect(q('.task-aside')).toBeNull()
  })

  it('closes the same way when the task is deleted live', async () => {
    const { wrapper, store } = await mountAside()
    expect(q('.task-aside')).not.toBeNull()
    store.remove({ id: 9, project_id: 5 })
    await flushPromises()
    expect(wrapper.emitted('close')).toEqual([[true]])
  })

  it('keeps the typed text on a live edit but refreshes a pristine form', async () => {
    const { store } = await mountAside()
    store.replace({ ...base, title: 'Live', updated_at: '2026-01-03T00:00:00.000000Z' })
    await flushPromises()
    expect(q<HTMLInputElement>('#task-aside-title')!.value).toBe('Live')
    await type('#task-aside-title', 'Mine')
    store.replace({ ...base, title: 'Live 2', updated_at: '2026-01-04T00:00:00.000000Z' })
    await flushPromises()
    expect(q<HTMLInputElement>('#task-aside-title')!.value).toBe('Mine')
  })

  it('emits close from the button', async () => {
    const { wrapper } = await mountAside()
    q<HTMLButtonElement>('[name="close-task"]')!.click()
    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('renders a bottom sheet on narrow viewports', async () => {
    fakeMatchMedia(true)
    const { wrapper } = await mountAside()
    const sheet = document.querySelector('[role="dialog"]')
    expect(sheet).not.toBeNull()
    expect(sheet!.className).toContain('app-dialog--sheet-bottom')
    expect(sheet!.querySelector('.task-aside')!.classList.contains('wide')).toBe(false)
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
