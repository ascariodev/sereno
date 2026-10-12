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

const originalMatchMedia = window.matchMedia

function fakeMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })
}

async function mountAside(task: Task | null = base, props: Record<string, unknown> = {}, who: { userId?: number; roles?: string[] } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useOrganizationStore().$patch({ activeId: 1, organizations: [{ id: 1, name: 'Org', roles: who.roles ?? ['member'] }] as never })
  useAuthStore().$patch({ user: { id: who.userId ?? 1 } as never })
  useMemberDirectoryStore().$patch({ entries: { 5: { members: [{ id: 3, name: 'Bea', email: 'b@b.c', role: 'member', joined_at: null }], loaded: true, loadedAt: Date.now(), generation: 0, inFlight: null } } })
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
  afterEach(() => {
    useTasksStore().clear()
    window.matchMedia = originalMatchMedia
  })

  it('fills the form and saves the three fields through the store', async () => {
    const spy = vi.spyOn(tasksApi, 'updateTask').mockResolvedValue({ ...base, title: 'New', description: null, assignee: { id: 3, name: 'Bea' }, updated_at: '2026-01-02T00:00:00.000000Z' })
    await mountAside()
    expect(q<HTMLInputElement>('#task-aside-title')!.value).toBe('Fix it')
    expect(q<HTMLButtonElement>('[data-test="submit"]')!.disabled).toBe(true)
    await type('#task-aside-title', ' New ')
    q<HTMLButtonElement>('[data-test="edit-description"]')!.click()
    await flushPromises()
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

  it('offers only the project members and keeps a current assignee who is not one', async () => {
    await mountAside({ ...base, assignee: { id: 4, name: 'Cy' } })
    useMemberDirectoryStore().$patch({ entries: { 6: { members: [{ id: 8, name: 'Zed', email: 'z@z.c', role: 'member', joined_at: null }], loaded: true, loadedAt: Date.now(), generation: 0, inFlight: null } } })
    await flushPromises()
    const options = Array.from(q<HTMLSelectElement>('#task-aside-assignee')!.options)
    expect(options.map((o) => o.textContent!.trim()).filter((t) => t === 'Bea' || t === 'Cy' || t === 'Zed')).toEqual(['Bea', 'Cy'])
    expect(options.map((o) => o.value)).toEqual(expect.arrayContaining(['3', '4']))
    expect(options.map((o) => o.value)).not.toContain('8')
    expect(q<HTMLSelectElement>('#task-aside-assignee')!.value).toBe('4')
  })

  it('shows the description as rendered Markdown and edits it with the editor', async () => {
    const spy = vi.spyOn(tasksApi, 'updateTask').mockResolvedValue({ ...base, description: '**Bold** <script>x</script>', updated_at: '2026-01-02T00:00:00.000000Z' })
    await mountAside({ ...base, description: '**Bold** <img src=x onerror=alert(1)>' })
    expect(q('[data-test="description-view"] strong')!.textContent).toBe('Bold')
    expect(q('[data-test="description-view"] img')).toBeNull()
    expect(q('#task-aside-description')).toBeNull()
    q<HTMLButtonElement>('[data-test="edit-description"]')!.click()
    await flushPromises()
    expect(q<HTMLTextAreaElement>('#task-aside-description')!.value).toBe('**Bold** <img src=x onerror=alert(1)>')
    expect(q('[data-test="tool-bold"]')).not.toBeNull()
    await type('#task-aside-description', '**Bold** <script>x</script>')
    await submit()
    expect(spy).toHaveBeenCalledWith(5, 9, { title: 'Fix it', description: '**Bold** <script>x</script>', assigneeId: null })
    expect(q('#task-aside-description')).toBeNull()
    expect(q('[data-test="description-view"] strong')).not.toBeNull()
  })

  it('blocks a description over the limit counted in characters and links the error', async () => {
    const spy = vi.spyOn(tasksApi, 'updateTask').mockResolvedValue(base)
    await mountAside()
    q<HTMLButtonElement>('[data-test="edit-description"]')!.click()
    await flushPromises()
    await type('#task-aside-description', '😀'.repeat(10001))
    await submit()
    expect(spy).not.toHaveBeenCalled()
    expect(q('[data-test="error-description"]')).not.toBeNull()
    expect(q('#task-aside-description')!.getAttribute('aria-invalid')).toBe('true')
    expect(q('#task-aside-description')!.getAttribute('aria-describedby')).toBe('task-aside-description-error-0')
  })

  it('moves focus into the editor on open and back to the edit button on cancel, restoring the value', async () => {
    await mountAside()
    q<HTMLButtonElement>('[data-test="edit-description"]')!.click()
    await flushPromises()
    expect(document.activeElement).toBe(q('#task-aside-description'))
    await type('#task-aside-description', 'changed')
    q<HTMLButtonElement>('[data-test="cancel-description"]')!.click()
    await flushPromises()
    expect(q('#task-aside-description')).toBeNull()
    expect(document.activeElement).toBe(q('[data-test="edit-description"]'))
    expect(q('[data-test="description-view"]')!.textContent).toContain('Details')
    expect(q<HTMLButtonElement>('[data-test="submit"]')!.disabled).toBe(true)
  })

  it('returns focus to the edit button after a successful save', async () => {
    vi.spyOn(tasksApi, 'updateTask').mockResolvedValue({ ...base, description: 'New text', updated_at: '2026-01-02T00:00:00.000000Z' })
    await mountAside()
    q<HTMLButtonElement>('[data-test="edit-description"]')!.click()
    await flushPromises()
    await type('#task-aside-description', 'New text')
    await submit()
    expect(document.activeElement).toBe(q('[data-test="edit-description"]'))
  })

  it('reopens and focuses the editor on a 422 for description', async () => {
    vi.spyOn(tasksApi, 'updateTask').mockRejectedValue(new ApiError(422, 'bad', { description: ['Too long'] }))
    await mountAside()
    q<HTMLButtonElement>('[data-test="edit-description"]')!.click()
    await flushPromises()
    await type('#task-aside-description', 'x')
    q<HTMLButtonElement>('[data-test="cancel-description"]')!.click()
    await flushPromises()
    await type('#task-aside-title', 'Other')
    await submit()
    expect(q('#task-aside-description')).not.toBeNull()
    expect(document.activeElement).toBe(q('#task-aside-description'))
    expect(q('#task-aside-description')!.getAttribute('aria-describedby')).toBe('task-aside-description-error-0')
  })

  it('closes the editor on cancel even with a description error and clears it', async () => {
    await mountAside()
    q<HTMLButtonElement>('[data-test="edit-description"]')!.click()
    await flushPromises()
    await type('#task-aside-description', '😀'.repeat(10001))
    await submit()
    expect(q('[data-test="error-description"]')).not.toBeNull()
    q<HTMLButtonElement>('[data-test="cancel-description"]')!.click()
    await flushPromises()
    expect(q('#task-aside-description')).toBeNull()
    expect(q('[data-test="error-description"]')).toBeNull()
    expect(document.activeElement).toBe(q('#task-aside-description-edit'))
  })

  it('does not steal focus on a task change after saving only the title', async () => {
    vi.spyOn(tasksApi, 'updateTask').mockResolvedValue({ ...base, title: 'Renamed', updated_at: '2026-01-02T00:00:00.000000Z' })
    const { wrapper, store } = await mountAside()
    store.insert({ ...base, id: 10, key: 'P-2', number: 2, title: 'Other task' })
    await type('#task-aside-title', 'Renamed')
    await submit()
    q<HTMLButtonElement>('[data-test="edit-description"]')!.click()
    await flushPromises()
    await wrapper.setProps({ taskId: 10 })
    await flushPromises()
    expect(q('#task-aside-description')).toBeNull()
    expect(document.activeElement).not.toBe(q('[data-test="edit-description"]'))
  })

  it('closes the editor when the task changes', async () => {
    const { wrapper, store } = await mountAside()
    store.insert({ ...base, id: 10, key: 'P-2', number: 2, title: 'Other task' })
    q<HTMLButtonElement>('[data-test="edit-description"]')!.click()
    await flushPromises()
    expect(q('#task-aside-description')).not.toBeNull()
    await wrapper.setProps({ taskId: 10 })
    await flushPromises()
    expect(q('#task-aside-description')).toBeNull()
    expect(document.activeElement).not.toBe(q('[data-test="edit-description"]'))
  })

  it('offers to add a description when there is none', async () => {
    await mountAside({ ...base, description: null })
    expect(q('[data-test="description-empty"]')).not.toBeNull()
    expect(q('[data-test="edit-description"]')).not.toBeNull()
  })

  describe('task list', () => {
    const withTasks = { ...base, description: 'Todo\n\n- [ ] one\n- [x] two' }
    const box = (index: number) => document.body.querySelectorAll<HTMLInputElement>('[data-test="description-view"] input')[index]
    async function check(index: number) {
      box(index).click()
      await flushPromises()
    }

    it('saves the toggled description and reflects it', async () => {
      const spy = vi.spyOn(tasksApi, 'updateTask').mockResolvedValue({ ...withTasks, description: 'Todo\n\n- [x] one\n- [x] two', updated_at: '2026-01-02T00:00:00.000000Z' })
      await mountAside(withTasks)
      box(0).focus()
      await check(0)
      expect(spy).toHaveBeenCalledWith(5, 9, { title: 'Fix it', description: 'Todo\n\n- [x] one\n- [x] two', assigneeId: null })
      expect(box(0).checked).toBe(true)
      expect(document.activeElement).toBe(box(0))
      expect(q<HTMLButtonElement>('[data-test="submit"]')!.disabled).toBe(true)
    })

    it('leaves the boxes disabled and saves nothing when read-only', async () => {
      const spy = vi.spyOn(tasksApi, 'updateTask').mockResolvedValue(withTasks)
      await mountAside(withTasks, { readOnly: true })
      expect(box(0).disabled).toBe(true)
      await check(0)
      expect(spy).not.toHaveBeenCalled()
    })

    it('keeps the old state and reports the failure on error', async () => {
      const spy = vi.spyOn(tasksApi, 'updateTask').mockRejectedValue(new ApiError(0, 'net', {}))
      const error = vi.spyOn(toast, 'error')
      await mountAside(withTasks)
      await check(0)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalled()
      expect(box(0).checked).toBe(false)
      expect(box(0).disabled).toBe(false)
    })

    function pendingUpdate() {
      let resolve!: (task: Task) => void
      const spy = vi.spyOn(tasksApi, 'updateTask').mockImplementation(() => new Promise<Task>((done) => { resolve = done }))
      return { spy, resolve: (task: Task) => resolve(task) }
    }
    const saved = { ...withTasks, description: 'Todo\n\n- [x] one\n- [x] two', updated_at: '2026-01-02T00:00:00.000000Z' }

    it('discards a second click while saving, marks the description busy and reverts the box', async () => {
      const { spy, resolve } = pendingUpdate()
      await mountAside(withTasks)
      const view = () => q('[data-test="description-view"]')!
      expect(view().hasAttribute('aria-busy')).toBe(false)
      await check(0)
      expect(view().getAttribute('aria-busy')).toBe('true')
      expect(box(0).disabled).toBe(false)
      await check(1)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(box(1).checked).toBe(true)
      resolve(saved)
      await flushPromises()
      expect(view().hasAttribute('aria-busy')).toBe(false)
      expect(box(0).checked).toBe(true)
    })

    it('disables the edit button while saving', async () => {
      const { resolve } = pendingUpdate()
      await mountAside(withTasks)
      await check(0)
      expect(q<HTMLButtonElement>('[data-test="edit-description"]')!.disabled).toBe(true)
      resolve(saved)
      await flushPromises()
      expect(q<HTMLButtonElement>('[data-test="edit-description"]')!.disabled).toBe(false)
    })

    it('does not overwrite an open editor draft when the save resolves', async () => {
      const { resolve } = pendingUpdate()
      const { wrapper } = await mountAside(withTasks)
      await check(0)
      ;(wrapper.vm as unknown as { fieldErrors: Record<string, string[]> }).fieldErrors = { description: ['x'] }
      await flushPromises()
      await type('#task-aside-description', 'draft')
      resolve(saved)
      await flushPromises()
      expect(q<HTMLTextAreaElement>('#task-aside-description')!.value).toBe('draft')
    })

    it('does not show boxes while the editor is open, so an unsaved edit is not overwritten', async () => {
      const spy = vi.spyOn(tasksApi, 'updateTask').mockResolvedValue(withTasks)
      await mountAside(withTasks)
      q<HTMLButtonElement>('[data-test="edit-description"]')!.click()
      await flushPromises()
      await type('#task-aside-description', 'draft')
      expect(box(0)).toBeUndefined()
      expect(spy).not.toHaveBeenCalled()
    })
  })

  it('is read-only when the project is archived', async () => {
    const spy = vi.spyOn(tasksApi, 'updateTask').mockResolvedValue(base)
    await mountAside(base, { readOnly: true })
    expect(q('[data-test="read-only"]')).not.toBeNull()
    expect(q<HTMLInputElement>('#task-aside-title')!.readOnly).toBe(true)
    expect(q<HTMLSelectElement>('#task-aside-assignee')!.disabled).toBe(true)
    expect(q('[data-test="description-view"]')).not.toBeNull()
    expect(q('[data-test="edit-description"]')).toBeNull()
    expect(q('#task-aside-description')).toBeNull()
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

  it('loads a task that is not on the board and shows it', async () => {
    const get = vi.spyOn(tasksApi, 'getTask').mockResolvedValue(base)
    const { wrapper } = await mountAside(null)
    expect(get).toHaveBeenCalledWith(5, 9, expect.anything())
    expect(q('.task-aside')).not.toBeNull()
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('closes with replace and a toast when the task is not in the store nor in the API', async () => {
    vi.spyOn(tasksApi, 'getTask').mockRejectedValue(new ApiError(404, 'gone', {}))
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

    it('releases the saving state when a delete started meanwhile fails', async () => {
      let resolveSave!: (task: Task) => void
      vi.spyOn(tasksApi, 'updateTask').mockReturnValue(new Promise<Task>((r) => (resolveSave = r)))
      vi.spyOn(tasksApi, 'deleteTask').mockRejectedValue(new ApiError(403, 'no', {}))
      await mountAside()
      q<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
      await flushPromises()
      expect(q('[data-test="description-view"]')!.getAttribute('aria-busy')).toBe('true')
      q<HTMLButtonElement>('[data-test="delete"]')!.click()
      await flushPromises()
      confirmBtn().click()
      await flushPromises()
      resolveSave({ ...base, updated_at: '2026-01-02T00:00:00.000000Z' })
      await flushPromises()
      expect(q('[data-test="description-view"]')!.getAttribute('aria-busy')).toBeNull()
    })

    it('a save 404 while a delete is pending closes once even if the delete then fails with 403', async () => {
      let rejectSave!: (e: unknown) => void
      let rejectDelete!: (e: unknown) => void
      vi.spyOn(tasksApi, 'updateTask').mockReturnValue(new Promise<Task>((_, r) => (rejectSave = r)))
      vi.spyOn(tasksApi, 'deleteTask').mockReturnValue(new Promise<void>((_, r) => (rejectDelete = r)))
      const error = vi.spyOn(toast, 'error')
      const wrapper = (await mountAside()).wrapper
      q<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
      await flushPromises()
      q<HTMLButtonElement>('[data-test="delete"]')!.click()
      await flushPromises()
      confirmBtn().click()
      await flushPromises()
      rejectSave(new ApiError(404, 'gone', {}))
      await flushPromises()
      rejectDelete(new ApiError(403, 'no', {}))
      await flushPromises()
      expect(error).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalledWith('This task no longer exists.')
      expect(wrapper.emitted('close')).toEqual([[true]])
    })

    it('a pending save resolving after a successful delete is harmless', async () => {
      let resolveSave!: (task: Task) => void
      vi.spyOn(tasksApi, 'updateTask').mockReturnValue(new Promise<Task>((r) => (resolveSave = r)))
      vi.spyOn(tasksApi, 'deleteTask').mockResolvedValue()
      const error = vi.spyOn(toast, 'error')
      const wrapper = (await mountAside()).wrapper
      q<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
      await flushPromises()
      q<HTMLButtonElement>('[data-test="delete"]')!.click()
      await flushPromises()
      confirmBtn().click()
      await flushPromises()
      resolveSave({ ...base, updated_at: '2026-01-02T00:00:00.000000Z' })
      await flushPromises()
      expect(error).not.toHaveBeenCalled()
      expect(wrapper.emitted('close')).toEqual([[true]])
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
