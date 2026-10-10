import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api, ApiError } from '../api/client'
import { i18n } from '../i18n'
import { createAppRouter } from '../router'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'
import { useTasksStore } from '../stores/tasks'
import { toast } from '../components/ui/toast'
import PlanView from './PlanView.vue'

enableAutoUnmount(afterEach)

const project = (id: number, key: string) => ({ id, name: `proj${id}`, key, description: null, archived_at: null, created_at: '', updated_at: '' })

function mockApi(tasks: (path: string) => unknown = () => ({ data: [] })) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/api/projects') return { data: [project(5, 'POSVE'), project(6, 'OTHER')], meta: { last_page: 1 } } as never
    if (path === '/api/channels') return { data: [{ id: 7, project_id: 5, name: 'general' }] } as never
    if (/^\/api\/projects\/\d+\/tasks$/.test(path)) return (await tasks(path)) as never
    return undefined as never
  })
}

const taskCalls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map(([path]) => path).filter((path) => /\/tasks$/.test(String(path)))

async function mountView(path = '/projects/5/plan') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().$patch({ token: 't', user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } })
  useOrganizationStore().$patch({ activeId: 1 })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  const wrapper = mount(PlanView, { global: { plugins: [pinia, i18n, router] } })
  await flushPromises()
  return Object.assign(wrapper, { router })
}

describe('PlanView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    useProjectsStore().clear()
    useTasksStore().clear()
  })

  it('opens the project, shows the header with Plan current and clears on unmount', async () => {
    const spy = mockApi()
    const wrapper = await mountView()
    expect(taskCalls(spy)).toEqual(['/api/projects/5/tasks'])
    expect(useTasksStore().projectId).toBe(5)
    expect(wrapper.find('h1').text()).toContain('proj5')
    const current = wrapper.find('nav[aria-label="Project views"] a[aria-current=page]')
    expect(current.attributes('href')).toBe('/projects/5/plan')
    wrapper.unmount()
    expect(useTasksStore().projectId).toBeNull()
  })

  it('shows loading while the tasks load', async () => {
    let release: (value: unknown) => void = () => {}
    mockApi(() => new Promise((resolve) => (release = resolve)))
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Loading...')
    release({ data: [] })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Loading...')
  })

  it('reopens when the route changes to another project', async () => {
    const spy = mockApi()
    const wrapper = await mountView()
    await wrapper.router.push('/projects/6/plan')
    await flushPromises()
    expect(taskCalls(spy)).toEqual(['/api/projects/5/tasks', '/api/projects/6/tasks'])
    expect(useTasksStore().projectId).toBe(6)
  })

  it('does not reopen when only the query changes', async () => {
    const spy = mockApi()
    const wrapper = await mountView()
    await wrapper.router.push('/projects/5/plan?task=3')
    await flushPromises()
    expect(taskCalls(spy)).toHaveLength(1)
  })

  it('shows an error with retry on failure', async () => {
    let fail = true
    const spy = mockApi(() => {
      if (fail) throw new ApiError(500, 'boom')
      return { data: [] }
    })
    const wrapper = await mountView()
    expect(wrapper.find('[role=alert]').text()).toContain('Could not load the tasks.')
    fail = false
    await wrapper.find('button[name=retry]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    expect(taskCalls(spy)).toHaveLength(2)
  })

  it('shows not found on a 404', async () => {
    mockApi(() => {
      throw new ApiError(404, 'nope')
    })
    const wrapper = await mountView()
    expect(wrapper.find('[role=alert]').text()).toContain('does not exist')
  })

  it('shows not found for an invalid project id without loading', async () => {
    const spy = mockApi()
    const invalid = await mountView('/projects/abc/plan')
    expect(invalid.find('[role=alert]').text()).toContain('does not exist')
    expect(taskCalls(spy)).toHaveLength(0)
  })

  describe('board', () => {
    const task = (id: number, status: string, extra: Record<string, unknown> = {}) => ({
      id, project_id: 5, key: `POSVE-${id}`, number: id, title: `Task ${id}`, description: null, status, position: id,
      created_by: 1, assignee: null, log_group: null, created_at: '2026-10-10T00:00:00.000000Z', updated_at: '2026-10-10T00:00:00.000000Z', ...extra,
    })

    it('renders four columns with counts, empty state per column and cards linking to ?task=', async () => {
      mockApi(() => ({
        data: [
          task(1, 'todo', { assignee: { id: 1, name: 'Ana Perez' }, log_group: { id: 9, level: 'critical', title: 'g', status: 'open', events_count: 214 } }),
          task(2, 'todo'),
          task(3, 'done'),
        ],
      }))
      const wrapper = await mountView()
      const columns = wrapper.findAll('section.plan-view__column')
      expect(columns.map((c) => c.find('h2').text())).toEqual(['To do', 'In progress', 'In review', 'Done'])
      expect(columns.map((c) => c.find('.plan-view__count').text())).toEqual(['2', '0', '0', '1'])
      expect(columns[1].text()).toContain('No tasks')
      expect(columns[0].text()).not.toContain('No tasks')
      const card = columns[0].find('a.task-card')
      expect(card.attributes('href')).toBe('/projects/5/plan?task=1')
      expect(card.attributes('aria-labelledby')).toBe('task-1-title')
      expect(wrapper.find('#task-1-title').text()).toBe('Task 1')
      expect(card.text()).toContain('POSVE-1')
      expect(card.text()).toContain('214 events')
      expect(card.find('.level-pill').attributes('data-level')).toBe('critical')
      expect(wrapper.find('#task-1-meta').text()).toContain('Assigned to Ana Perez')
      expect(wrapper.find('#task-2-meta').text()).toContain('Unassigned')
    })

    it('covers describedby, avatar, notice chip, query and loading', async () => {
      mockApi(() => ({
        data: [
          task(1, 'todo', { assignee: { id: 1, name: 'Ana Perez' }, log_group: { id: 9, level: 'error', title: 'g', status: 'open', events_count: 1 } }),
          task(2, 'todo'),
        ],
      }))
      const wrapper = await mountView('/projects/5/plan?foo=bar')
      const [first, second] = wrapper.findAll('a.task-card')
      expect(first.attributes('aria-describedby')).toBe('task-1-meta')
      expect(first.find('.app-avatar').exists()).toBe(true)
      expect(first.find('.level-pill').exists()).toBe(true)
      expect(first.text()).toContain('From a log notice')
      expect(first.attributes('href')).toBe('/projects/5/plan?foo=bar&task=1')
      expect(second.find('.app-avatar').exists()).toBe(false)
      expect(second.find('.level-pill').exists()).toBe(false)
      expect(second.text()).not.toContain('From a log notice')
    })

    it('shows no board while loading', async () => {
      mockApi(() => new Promise(() => {}))
      const wrapper = await mountView()
      expect(wrapper.text()).toContain('Loading...')
      expect(wrapper.find('.plan-view__board').exists()).toBe(false)
    })

    it('hides the board while loading and on error', async () => {
      mockApi(() => {
        throw new ApiError(500, 'boom')
      })
      const wrapper = await mountView()
      expect(wrapper.find('.plan-view__board').exists()).toBe(false)
    })
  })

  describe('filters', () => {
    const task = (id: number, extra: Record<string, unknown> = {}) => ({
      id, project_id: 5, key: `POSVE-${id}`, number: id, title: `Task ${id}`, description: null, status: 'todo', position: id,
      created_by: 1, assignee: null, log_group: null, created_at: '2026-10-10T00:00:00.000000Z', updated_at: '2026-10-10T00:00:00.000000Z', ...extra,
    })
    const data = () => ({
      data: [
        task(1, { assignee: { id: 1, name: 'Ana' } }),
        task(2, { log_group: { id: 9, level: 'error', title: 'g', status: 'open', events_count: 1 } }),
        task(3),
      ],
    })
    const chips = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('.plan-view__chip')
    const titles = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('a.task-card').map((c) => c.find('[id$=-title]').text())

    afterEach(() => {
      useTasksStore().filter = 'all'
    })

    it('shows the chips with Todas pressed by default and all tasks', async () => {
      mockApi(data)
      const wrapper = await mountView()
      expect(chips(wrapper).map((c) => c.text())).toEqual(['All', 'Mine', 'From notices'])
      expect(chips(wrapper).map((c) => c.attributes('aria-pressed'))).toEqual(['true', 'false', 'false'])
      expect(titles(wrapper)).toEqual(['Task 1', 'Task 2', 'Task 3'])
    })

    it('applies the filter from the query on mount', async () => {
      mockApi(data)
      const wrapper = await mountView('/projects/5/plan?filter=mine')
      expect(chips(wrapper).map((c) => c.attributes('aria-pressed'))).toEqual(['false', 'true', 'false'])
      expect(titles(wrapper)).toEqual(['Task 1'])
    })

    it('falls back to all for an invalid value', async () => {
      mockApi(data)
      useTasksStore().filter = 'mine'
      const wrapper = await mountView('/projects/5/plan?filter=bogus')
      expect(chips(wrapper)[0].attributes('aria-pressed')).toBe('true')
      expect(titles(wrapper)).toHaveLength(3)
    })

    it('writes the filter to the query keeping ?task= and without reloading', async () => {
      const spy = mockApi(data)
      const wrapper = await mountView('/projects/5/plan?task=2')
      await chips(wrapper)[2].trigger('click')
      await flushPromises()
      expect(wrapper.router.currentRoute.value.query).toEqual({ task: '2', filter: 'from_notices' })
      expect(useTasksStore().filter).toBe('from_notices')
      expect(titles(wrapper)).toEqual(['Task 2'])
      expect(chips(wrapper)[2].attributes('aria-pressed')).toBe('true')
      await chips(wrapper)[0].trigger('click')
      await flushPromises()
      expect(wrapper.router.currentRoute.value.query).toEqual({ task: '2' })
      expect(titles(wrapper)).toHaveLength(3)
      expect(taskCalls(spy)).toHaveLength(1)
    })

    it('does not touch the filter when only another query param changes', async () => {
      mockApi(data)
      const wrapper = await mountView('/projects/5/plan?filter=mine')
      useTasksStore().filter = 'from_notices'
      await wrapper.router.push('/projects/5/plan?filter=mine&task=1')
      await flushPromises()
      expect(useTasksStore().filter).toBe('from_notices')
    })
  })
  describe('create', () => {
    it('opens the dialog from the header with To do and from a column button with that column', async () => {
      mockApi()
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 1 } } as never)
      const wrapper = await mountView()
      await wrapper.get('button[name=new-task]').trigger('click')
      await flushPromises()
      expect(document.body.querySelector('#task-create-title')).not.toBeNull()
      document.body.querySelector<HTMLButtonElement>('[data-test=cancel]')!.click()
      await flushPromises()
      expect(document.body.querySelector('#task-create-title')).toBeNull()
      await wrapper.get('button[name=add-in_review]').trigger('click')
      await flushPromises()
      const input = document.body.querySelector<HTMLInputElement>('#task-create-title')!
      input.value = 'New one'
      input.dispatchEvent(new Event('input'))
      document.body.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
      await flushPromises()
      expect(post).toHaveBeenCalledWith('/api/projects/5/tasks', expect.objectContaining({ title: 'New one', status: 'in_review' }))
    })

    it('has no create buttons in an archived project', async () => {
      vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
        if (path === '/api/projects') return { data: [{ ...project(5, 'POSVE'), archived_at: '2026-01-01' }], meta: { last_page: 1 } } as never
        if (path === '/api/channels') return { data: [] } as never
        return { data: [] } as never
      })
      const wrapper = await mountView()
      expect(wrapper.find('button[name=new-task]').exists()).toBe(false)
      expect(wrapper.find('button[name=add-todo]').exists()).toBe(false)
    })
  })

  describe('task panel', () => {
    const task = (id: number, extra: Record<string, unknown> = {}) => ({
      id, project_id: 5, key: `POSVE-${id}`, number: id, title: `Task ${id}`, description: null, status: 'todo', position: id,
      created_by: 1, assignee: null, log_group: null, created_at: '2026-10-10T00:00:00.000000Z', updated_at: '2026-10-10T00:00:00.000000Z', ...extra,
    })

    it('opens the panel from ?task= and closing keeps ?filter=', async () => {
      mockApi(() => ({ data: [task(1), task(2)] }))
      const wrapper = await mountView('/projects/5/plan?filter=all&task=2&x=1')
      expect((wrapper.get('#task-aside-title').element as HTMLInputElement).value).toBe('Task 2')
      await wrapper.get('button[name=close-task]').trigger('click')
      await flushPromises()
      expect(wrapper.router.currentRoute.value.query).toEqual({ filter: 'all', x: '1' })
      expect(wrapper.find('#task-aside-title').exists()).toBe(false)
    })

    it('replaces the URL and shows no panel when the task does not exist', async () => {
      mockApi(() => ({ data: [task(1)] }))
      const wrapper = await mountView('/projects/5/plan?filter=mine&task=99')
      expect(wrapper.find('#task-aside-title').exists()).toBe(false)
      expect(wrapper.router.currentRoute.value.query).toEqual({ filter: 'mine' })
    })

    it('does not close a deep link while the tasks are still loading', async () => {
      const error = vi.spyOn(toast, 'error')
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      mockApi(async () => {
        await gate
        return { data: [task(1)] }
      })
      const pinia = createPinia()
      setActivePinia(pinia)
      useAuthStore().$patch({ token: 't', user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } })
      useOrganizationStore().$patch({ activeId: 1 })
      const router = createAppRouter(createMemoryHistory())
      await router.push('/projects/5/plan?task=1')
      const wrapper = mount(PlanView, { global: { plugins: [pinia, i18n, router] } })
      await flushPromises()
      expect(wrapper.find('#task-aside-title').exists()).toBe(false)
      expect(error).not.toHaveBeenCalled()
      expect(router.currentRoute.value.query).toEqual({ task: '1' })
      release()
      await flushPromises()
      expect((wrapper.get('#task-aside-title').element as HTMLInputElement).value).toBe('Task 1')
      expect(error).not.toHaveBeenCalled()
    })

    it('ignores a malformed ?task=', async () => {
      mockApi(() => ({ data: [task(1)] }))
      const wrapper = await mountView('/projects/5/plan?task=abc')
      expect(wrapper.find('#task-aside-title').exists()).toBe(false)
    })

    it('is read-only in an archived project', async () => {
      vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
        if (path === '/api/projects') return { data: [{ ...project(5, 'POSVE'), archived_at: '2026-01-01' }], meta: { last_page: 1 } } as never
        if (path === '/api/channels') return { data: [] } as never
        return { data: [task(1)] } as never
      })
      const wrapper = await mountView('/projects/5/plan?task=1')
      expect((wrapper.get('#task-aside-title').element as HTMLInputElement).readOnly).toBe(true)
      expect(wrapper.find('[data-test=submit]').exists()).toBe(false)
    })
  })
  describe('move menu', () => {
    const mk = (id: number, status: string, position = id) => ({
      id, project_id: 5, key: `POSVE-${id}`, number: id, title: `Task ${id}`, description: null, status, position,
      created_by: 1, assignee: null, log_group: null, created_at: '2026-10-10T00:00:00.000000Z', updated_at: '2026-10-10T00:00:00.000000Z',
    })
    const data = () => ({ data: [mk(1, 'todo'), mk(2, 'todo'), mk(3, 'todo'), mk(4, 'done')] })
    const settle = async () => {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    async function openMenu(wrapper: ReturnType<typeof mount>, id: number) {
      const trigger = wrapper.get(`#task-${id}-title`).element.closest('.task-card-wrap')!.querySelector('button[name=move-task]')!
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      await settle()
      const menu = document.querySelector('[role=menu]')
      expect(menu).not.toBeNull()
      return [...menu!.querySelectorAll<HTMLElement>('[role=menuitem]')]
    }
    const pick = async (items: HTMLElement[], label: string) => {
      const item = items.find((el) => el.textContent?.trim() === label)!
      item.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }))
      item.click()
      await settle()
    }

    it('opens from the keyboard with up, down and the other columns, disabling the edges', async () => {
      mockApi(data)
      const wrapper = await mountView()
      const first = await openMenu(wrapper, 1)
      expect(first.map((el) => el.textContent?.trim())).toEqual(['Move up', 'Move down', 'Move to In progress', 'Move to In review', 'Move to Done'])
      expect(first[0].hasAttribute('data-disabled')).toBe(true)
      expect(first[1].hasAttribute('data-disabled')).toBe(false)
      expect(wrapper.get('button[name=move-task]').attributes('aria-label')).toBe('Move POSVE-1')
    })

    it('moves to the end of another column using the full column neighbours', async () => {
      mockApi(data)
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { ...mk(1, 'done', 5), updated_at: '2026-10-10T00:00:01.000000Z' } } as never)
      const wrapper = await mountView()
      await pick(await openMenu(wrapper, 1), 'Move to Done')
      expect(post).toHaveBeenCalledWith('/api/projects/5/tasks/1/move', { status: 'done', after_id: 4, before_id: undefined })
      expect(useTasksStore().columns.done.map((item) => item.id)).toEqual([4, 1])
    })

    it('moves down and up within the column', async () => {
      mockApi(data)
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: mk(1, 'todo', 2.5) } as never)
      const wrapper = await mountView()
      await pick(await openMenu(wrapper, 1), 'Move down')
      expect(post).toHaveBeenLastCalledWith('/api/projects/5/tasks/1/move', { status: 'todo', after_id: 2, before_id: 3 })
      await pick(await openMenu(wrapper, 3), 'Move up')
      expect(post).toHaveBeenLastCalledWith('/api/projects/5/tasks/3/move', { status: 'todo', after_id: 2, before_id: 1 })
    })

    it('shows a toast when the move fails', async () => {
      mockApi(data)
      vi.spyOn(api, 'post').mockRejectedValue(new ApiError(500, 'boom'))
      const error = vi.spyOn(toast, 'error')
      const wrapper = await mountView()
      await pick(await openMenu(wrapper, 1), 'Move to Done')
      expect(error).toHaveBeenCalledWith('Could not move the task. Try again.')
      expect(useTasksStore().columns.todo.map((item) => item.id)).toEqual([1, 2, 3])
    })

    it('has no menu in an archived project', async () => {
      vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
        if (path === '/api/projects') return { data: [{ ...project(5, 'POSVE'), archived_at: '2026-01-01' }], meta: { last_page: 1 } } as never
        if (path === '/api/channels') return { data: [] } as never
        return data() as never
      })
      const wrapper = await mountView()
      expect(wrapper.findAll('a.task-card')).toHaveLength(4)
      expect(wrapper.find('button[name=move-task]').exists()).toBe(false)
    })
  })

  describe('drag and drop', () => {
    const mk = (id: number, status: string, mine = false) => ({
      id, project_id: 5, key: `POSVE-${id}`, number: id, title: `Task ${id}`, description: null, status, position: id,
      created_by: 1, assignee: mine ? { id: 1, name: 'Ana' } : null, log_group: null,
      created_at: '2026-10-10T00:00:00.000000Z', updated_at: '2026-10-10T00:00:00.000000Z',
    })
    const data = () => ({ data: [mk(1, 'todo'), mk(2, 'todo'), mk(3, 'todo'), mk(4, 'done')] })

    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const cards = [...(this.parentElement?.querySelectorAll(':scope > [data-task-id]') ?? [])]
        const top = cards.indexOf(this) * 100
        return { top, height: 100, bottom: top + 100, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect
      })
    })

    function fire(target: Element, type: string, init: { clientY?: number; relatedTarget?: Element | null } = {}) {
      const dataTransfer = { effectAllowed: 'uninitialized', dropEffect: 'none', setData: vi.fn() }
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(event, { dataTransfer, clientY: init.clientY ?? 0, relatedTarget: init.relatedTarget ?? null })
      target.dispatchEvent(event)
      return { event, dataTransfer }
    }
    const card = (wrapper: ReturnType<typeof mount>, id: number) => wrapper.get(`[data-task-id="${id}"]`).element
    const column = (wrapper: ReturnType<typeof mount>, status: string) => wrapper.get(`.plan-view__column--${status}`).element
    /** Drags `id` over `status` at `clientY` (cards are 100px tall from 0) and drops it. */
    async function dragTo(wrapper: ReturnType<typeof mount>, id: number, status: string, clientY: number) {
      fire(card(wrapper, id), 'dragstart')
      fire(column(wrapper, status), 'dragover', { clientY })
      await flushPromises()
      fire(column(wrapper, status), 'drop', { clientY })
      fire(card(wrapper, id), 'dragend')
      await flushPromises()
    }

    it('drags to the end of another column with a drop indicator and the full column neighbours', async () => {
      mockApi(data)
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { ...mk(1, 'done'), position: 5, updated_at: '2026-10-10T00:00:01.000000Z' } } as never)
      const wrapper = await mountView()
      expect(card(wrapper, 1).getAttribute('draggable')).toBe('true')
      expect(card(wrapper, 1).querySelector('a')!.getAttribute('draggable')).toBe('false')
      const started = fire(card(wrapper, 1), 'dragstart')
      expect(started.dataTransfer.effectAllowed).toBe('move')
      expect(started.dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'POSVE-1')
      const over = fire(column(wrapper, 'done'), 'dragover', { clientY: 500 })
      expect(over.event.defaultPrevented).toBe(true)
      await flushPromises()
      expect(column(wrapper, 'done').classList).toContain('plan-view__column--drop')
      const lines = column(wrapper, 'done').querySelectorAll('.plan-view__drop-line')
      expect(lines).toHaveLength(1)
      expect(lines[0].previousElementSibling?.getAttribute('data-task-id')).toBe('4')
      fire(column(wrapper, 'done'), 'drop', { clientY: 500 })
      await flushPromises()
      expect(post).toHaveBeenCalledWith('/api/projects/5/tasks/1/move', { status: 'done', after_id: 4, before_id: null })
      expect(useTasksStore().columns.done.map((item) => item.id)).toEqual([4, 1])
      expect(wrapper.find('.plan-view__drop-line').exists()).toBe(false)
      expect(wrapper.find('.plan-view__column--drop').exists()).toBe(false)
    })

    it('reorders within a column by the pointer position', async () => {
      mockApi(data)
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { ...mk(3, 'todo'), position: 0 } } as never)
      const wrapper = await mountView()
      fire(card(wrapper, 3), 'dragstart')
      fire(column(wrapper, 'todo'), 'dragover', { clientY: 20 })
      await flushPromises()
      expect(column(wrapper, 'todo').querySelector('.plan-view__drop-line')?.nextElementSibling?.getAttribute('data-task-id')).toBe('1')
      fire(column(wrapper, 'todo'), 'drop', { clientY: 20 })
      await flushPromises()
      expect(post).toHaveBeenCalledWith('/api/projects/5/tasks/3/move', { status: 'todo', after_id: null, before_id: 1 })
    })

    it('does nothing when dropped in the same place', async () => {
      mockApi(data)
      const post = vi.spyOn(api, 'post')
      const wrapper = await mountView()
      fire(card(wrapper, 2), 'dragstart')
      fire(column(wrapper, 'todo'), 'dragover', { clientY: 150 })
      await flushPromises()
      expect(wrapper.find('.plan-view__drop-line').exists()).toBe(false)
      fire(column(wrapper, 'todo'), 'drop', { clientY: 150 })
      await flushPromises()
      expect(post).not.toHaveBeenCalled()
    })

    it('clears the column highlight when the drag leaves it', async () => {
      mockApi(data)
      const wrapper = await mountView()
      fire(card(wrapper, 1), 'dragstart')
      fire(column(wrapper, 'done'), 'dragover', { clientY: 0 })
      await flushPromises()
      fire(column(wrapper, 'done'), 'dragleave', { relatedTarget: card(wrapper, 4) })
      await flushPromises()
      expect(column(wrapper, 'done').classList).toContain('plan-view__column--drop')
      fire(column(wrapper, 'done'), 'dragleave', { relatedTarget: column(wrapper, 'todo') })
      await flushPromises()
      expect(column(wrapper, 'done').classList).not.toContain('plan-view__column--drop')
    })

    it('with a filter on, anchors the drop to the visible neighbours in the full column', async () => {
      mockApi(() => ({ data: [mk(1, 'todo', true), mk(2, 'todo'), mk(3, 'todo', true), mk(5, 'todo'), mk(4, 'done', true)] }))
      const post = vi.spyOn(api, 'post').mockResolvedValue({ data: mk(4, 'done', true) } as never)
      const wrapper = await mountView('/projects/5/plan?filter=mine')
      expect(column(wrapper, 'todo').querySelectorAll('[data-task-id]')).toHaveLength(2)
      await dragTo(wrapper, 4, 'todo', 120)
      expect(post).toHaveBeenLastCalledWith('/api/projects/5/tasks/4/move', { status: 'todo', after_id: 2, before_id: 3 })
      await dragTo(wrapper, 4, 'todo', 500)
      expect(post).toHaveBeenLastCalledWith('/api/projects/5/tasks/4/move', { status: 'todo', after_id: 3, before_id: 5 })
    })

    it('blocks a second drop while a move is in flight', async () => {
      mockApi(data)
      let release: (value: unknown) => void = () => {}
      const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise((resolve) => (release = resolve)) as never)
      const wrapper = await mountView()
      await dragTo(wrapper, 1, 'done', 500)
      const again = fire(card(wrapper, 2), 'dragstart')
      expect(again.event.defaultPrevented).toBe(true)
      await dragTo(wrapper, 2, 'done', 500)
      expect(post).toHaveBeenCalledTimes(1)
      release({ data: { ...mk(1, 'done'), position: 5 } })
      await flushPromises()
    })

    it('shows a toast when the move fails', async () => {
      mockApi(data)
      vi.spyOn(api, 'post').mockRejectedValue(new ApiError(403, 'no'))
      const error = vi.spyOn(toast, 'error')
      const wrapper = await mountView()
      await dragTo(wrapper, 1, 'done', 500)
      expect(error).toHaveBeenCalledWith('You are not allowed to move this task.')
      expect(useTasksStore().columns.todo.map((item) => item.id)).toEqual([1, 2, 3])
    })

    it('cannot drag in an archived project', async () => {
      vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
        if (path === '/api/projects') return { data: [{ ...project(5, 'POSVE'), archived_at: '2026-01-01' }], meta: { last_page: 1 } } as never
        if (path === '/api/channels') return { data: [] } as never
        return data() as never
      })
      const post = vi.spyOn(api, 'post')
      const wrapper = await mountView()
      expect(card(wrapper, 1).hasAttribute('draggable')).toBe(false)
      expect(fire(card(wrapper, 1), 'dragstart').event.defaultPrevented).toBe(true)
      expect(fire(column(wrapper, 'done'), 'dragover', { clientY: 500 }).event.defaultPrevented).toBe(false)
      fire(column(wrapper, 'done'), 'drop', { clientY: 500 })
      await flushPromises()
      expect(post).not.toHaveBeenCalled()
      expect(wrapper.find('.plan-view__column--drop').exists()).toBe(false)
    })
  })
})
