import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import * as tasksApi from '../api/tasks'
import type { Task, TaskLogGroup } from '../api/types'
import { i18n } from '../i18n'
import { createAppRouter } from '../router'
import { useAuthStore } from '../stores/auth'
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

async function mountAside(task: Task | null = base, props: Record<string, unknown> = {}, who: { userId?: number; roles?: string[] } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useOrganizationStore().$patch({ activeId: 1, organizations: [{ id: 1, name: 'Org', roles: who.roles ?? ['member'] }] as never })
  useAuthStore().$patch({ user: { id: who.userId ?? 1 } as never })
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

  describe('delete', () => {
    const confirmBtn = () => q<HTMLButtonElement>('[data-test="delete-confirm"]')!

    async function openConfirm(task: Task | null = base, props = {}, who = {}) {
      const ctx = await mountAside(task, props, who)
      q<HTMLButtonElement>('[data-test="delete"]')!.click()
      await flushPromises()
      expect(q('[data-test="delete-text"]')!.textContent).toContain('P-1')
      return ctx
    }

    it('shows the action to the creator, admins and owners only, and never read-only', async () => {
      const cases: [{ userId: number; roles?: string[] }, boolean, Record<string, unknown>?][] = [
        [{ userId: 1 }, true],
        [{ userId: 2, roles: ['member'] }, false],
        [{ userId: 2, roles: ['admin'] }, true],
        [{ userId: 2, roles: ['owner'] }, true],
        [{ userId: 1 }, false, { readOnly: true }],
      ]
      for (const [who, visible, props] of cases) {
        const { wrapper } = await mountAside(base, props, who)
        expect(q('[data-test="delete"]') !== null).toBe(visible)
        wrapper.unmount()
      }
    })

    it('cancel closes the confirmation without deleting', async () => {
      const spy = vi.spyOn(tasksApi, 'deleteTask').mockResolvedValue()
      const { wrapper } = await openConfirm()
      q<HTMLButtonElement>('[data-test="delete-cancel"]')!.click()
      await flushPromises()
      expect(q('[data-test="delete-confirm"]')).toBeNull()
      expect(spy).not.toHaveBeenCalled()
      expect(wrapper.emitted('close')).toBeUndefined()
    })

    it('deletes, removes from the store and closes with replace, without a not-found toast', async () => {
      const spy = vi.spyOn(tasksApi, 'deleteTask').mockResolvedValue()
      const error = vi.spyOn(toast, 'error')
      const { wrapper, store } = await openConfirm()
      confirmBtn().click()
      await flushPromises()
      expect(spy).toHaveBeenCalledWith(5, 9)
      expect(store.find(9)).toBeUndefined()
      expect(wrapper.emitted('close')).toEqual([[true]])
      expect(error).not.toHaveBeenCalled()
    })

    it('disables the buttons while deleting', async () => {
      let resolve!: () => void
      const spy = vi.spyOn(tasksApi, 'deleteTask').mockReturnValue(new Promise<void>((r) => (resolve = r)))
      await openConfirm()
      confirmBtn().click()
      await flushPromises()
      expect(confirmBtn().disabled).toBe(true)
      expect(q<HTMLButtonElement>('[data-test="delete-cancel"]')!.disabled).toBe(true)
      confirmBtn().click()
      expect(spy).toHaveBeenCalledTimes(1)
      resolve()
      await flushPromises()
    })

    it('a 403 keeps the panel open and shows a toast', async () => {
      vi.spyOn(tasksApi, 'deleteTask').mockRejectedValue(new ApiError(403, 'no', {}))
      const error = vi.spyOn(toast, 'error')
      const { wrapper, store } = await openConfirm()
      confirmBtn().click()
      await flushPromises()
      expect(error).toHaveBeenCalledWith('You are not allowed to delete this task.')
      expect(wrapper.emitted('close')).toBeUndefined()
      expect(store.find(9)).toBeDefined()
      expect(q('[data-test="delete-confirm"]')).toBeNull()
    })

    it('a 404 closes with replace and the not-found toast', async () => {
      vi.spyOn(tasksApi, 'deleteTask').mockRejectedValue(new ApiError(404, 'gone', {}))
      const error = vi.spyOn(toast, 'error')
      const { wrapper } = await openConfirm()
      confirmBtn().click()
      await flushPromises()
      expect(error).toHaveBeenCalledTimes(1)
      expect(wrapper.emitted('close')).toEqual([[true]])
    })

    it('a network error keeps the panel open and shows the network toast', async () => {
      vi.spyOn(tasksApi, 'deleteTask').mockRejectedValue(new ApiError(0, 'net', {}))
      const error = vi.spyOn(toast, 'error')
      const { wrapper } = await openConfirm()
      confirmBtn().click()
      await flushPromises()
      expect(error).toHaveBeenCalledTimes(1)
      expect(wrapper.emitted('close')).toBeUndefined()
      expect(q('[data-test="delete"]')).not.toBeNull()
    })

    it('stacks the confirmation over the sheet on narrow viewports', async () => {
      fakeMatchMedia(true)
      vi.spyOn(tasksApi, 'deleteTask').mockResolvedValue()
      const { wrapper } = await openConfirm()
      expect(document.querySelectorAll('[role="dialog"]').length).toBe(2)
      confirmBtn().click()
      await flushPromises()
      expect(wrapper.emitted('close')).toEqual([[true]])
    })
  })
  it('moves from the panel menu and hides it when read-only', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { ...base, status: 'in_review', updated_at: '2026-01-02T00:00:00.000000Z' } } as never)
    const { wrapper } = await mountAside()
    const trigger = q('button[name=move-task]')!
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const item = [...document.body.querySelectorAll<HTMLElement>('[role=menuitem]')].find((el) => el.textContent?.trim() === 'Move to In review')!
    item.click()
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/api/projects/5/tasks/9/move', { status: 'in_review', after_id: null, before_id: undefined })
    wrapper.unmount()
    document.body.innerHTML = ''
    await mountAside(base, { readOnly: true })
    expect(q('button[name=move-task]')).toBeNull()
  })
})
