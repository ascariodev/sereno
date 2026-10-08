import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { LogGroup, Message, MessagePayload } from '../api/types'
import { i18n } from '../i18n'
import SystemNotice from './SystemNotice.vue'

const message = (payload: unknown, user: Message['user'] = null): Message => ({
  id: 1,
  channel_id: 7,
  kind: 'system',
  body: null,
  payload: payload as MessagePayload,
  log_group_id: 5,
  user,
  created_at: '2026-01-01T00:00:00Z',
})

const logGroup = (status: string): LogGroup =>
  ({
    id: 5,
    project_id: 3,
    level: 'error',
    title: 'Boom',
    status,
    events_count: 1,
    first_seen_at: '2026-01-01T00:00:00Z',
    last_seen_at: '2026-01-01T00:00:00Z',
  }) as LogGroup

function textIn(locale: 'en' | 'es', msg: Message): string {
  i18n.global.locale.value = locale
  return mount(SystemNotice, { props: { message: msg }, global: { plugins: [i18n] } }).text()
}

describe('SystemNotice', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    i18n.global.locale.value = 'en'
  })

  const opened = { type: 'log.group_opened', log_group_id: 5, level: 'error', title: 'Boom', events_count: 1 }
  const reopened = { type: 'log.group_reopened', log_group_id: 5, level: 'critical', title: 'Boom', events_count: 3 }
  const changed = { type: 'log.group_status_changed', log_group_id: 5, status: 'resolved', previous_status: 'open' }
  const ana = { id: 1, name: 'Ana' }

  it('renders log.group_opened as a card', () => {
    const en = textIn('en', message(opened))
    expect(en).toContain('error')
    expect(en).toContain('New log group')
    expect(en).toContain('Boom')
    expect(en).toContain('1 event')
    const es = textIn('es', message(opened))
    expect(es).toContain('Nuevo grupo de logs')
    expect(es).toContain('1 evento')
  })

  it('names the card by its kind label without repeating the level', () => {
    const wrapper = mount(SystemNotice, { props: { message: message(opened) }, global: { plugins: [i18n] } })
    const card = wrapper.get('article')
    expect(card.attributes('aria-label')).toBeUndefined()
    const labelId = card.attributes('aria-labelledby') as string
    expect(wrapper.get(`[id="${labelId}"]`).text()).toBe('New log group')
  })

  it('renders log.group_reopened with plural events', () => {
    const en = textIn('en', message(reopened))
    expect(en).toContain('Log group reopened')
    expect(en).toContain('critical')
    expect(en).toContain('3 events')
    const es = textIn('es', message(reopened))
    expect(es).toContain('Grupo de logs reabierto')
    expect(es).toContain('crítico')
    expect(es).toContain('3 eventos')
  })

  it('renders log.group_status_changed as a compact line with the actor', () => {
    expect(textIn('en', message(changed, ana))).toContain('Ana marked the log group as resolved')
    expect(textIn('es', message(changed, ana))).toContain('Ana marcó el grupo de logs como resuelto')
    expect(textIn('en', message(changed))).toContain('Someone marked the log group as resolved')
    const wrapper = mount(SystemNotice, { props: { message: message(changed, ana) }, global: { plugins: [i18n] } })
    expect(wrapper.find('article').exists()).toBe(false)
    expect(wrapper.find('.system-notice-line b').text()).toBe('Ana')
  })

  it('shows unknown levels and statuses as they come', () => {
    expect(textIn('en', message({ ...opened, level: 'verbose' }))).toContain('verbose')
    expect(textIn('en', message({ ...changed, status: 'archived' }, ana))).toContain('as archived')
  })

  it('emits select with the group id when the title is clicked', async () => {
    const wrapper = mount(SystemNotice, { props: { message: message(opened) }, global: { plugins: [i18n] } })
    await wrapper.find('a').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[5]])
    const line = mount(SystemNotice, { props: { message: message(changed, ana) }, global: { plugins: [i18n] } })
    expect(line.find('a').exists()).toBe(false)
  })

  it('falls back to the generic notice for an unknown or missing type', () => {
    expect(textIn('en', message({ type: 'something.new' }))).toBe('System notice')
    expect(textIn('es', message(null))).toBe('Aviso del sistema')
  })

  it('falls back to the generic notice when a known type lacks fields', () => {
    expect(textIn('en', message({ type: 'log.group_opened', log_group_id: 5 }))).toBe('System notice')
    expect(textIn('en', message({ ...opened, events_count: '1' }))).toBe('System notice')
    expect(textIn('en', message({ type: 'log.group_status_changed', log_group_id: 5 }, ana))).toBe('System notice')
  })

  describe('actions', () => {
    const mountActions = (payload: unknown, props: { projectId?: number } = { projectId: 3 }) =>
      mount(SystemNotice, { props: { message: message(payload), ...props }, global: { plugins: [i18n] } })

    it('shows the buttons only for opened and reopened groups with a project', () => {
      expect(mountActions(opened).find('button[name=resolve]').exists()).toBe(true)
      expect(mountActions(reopened).find('button[name=ignore]').exists()).toBe(true)
      expect(mountActions(changed).find('button').exists()).toBe(false)
      expect(mountActions({ type: 'something.new' }).find('button').exists()).toBe(false)
      expect(mountActions(opened, {}).find('button').exists()).toBe(false)
    })

    it('hides the buttons for an incomplete opened payload', () => {
      expect(mountActions({ type: 'log.group_opened', log_group_id: 5 }).find('button').exists()).toBe(false)
      expect(mountActions({ ...opened, log_group_id: undefined }).find('button').exists()).toBe(false)
    })

    it('calls the PATCH of the log group with the chosen status', async () => {
      const patch = vi.spyOn(api, 'patch').mockResolvedValue({})
      const wrapper = mountActions(opened)
      await wrapper.find('button[name=resolve]').trigger('click')
      expect(patch).toHaveBeenLastCalledWith('/api/projects/3/log-groups/5', { status: 'resolved' })
      const other = mountActions(opened)
      await other.find('button[name=ignore]').trigger('click')
      expect(patch).toHaveBeenLastCalledWith('/api/projects/3/log-groups/5', { status: 'ignored' })
    })

    it('disables the buttons while waiting and sends once', async () => {
      let finish: (value: unknown) => void = () => {}
      const patch = vi.spyOn(api, 'patch').mockReturnValue(new Promise((resolve) => (finish = resolve)))
      const wrapper = mountActions(opened)
      await wrapper.find('button[name=resolve]').trigger('click')
      expect(wrapper.find('button[name=resolve]').attributes('disabled')).toBeDefined()
      expect(wrapper.find('button[name=ignore]').attributes('disabled')).toBeDefined()
      await wrapper.find('button[name=resolve]').trigger('click')
      expect(patch).toHaveBeenCalledTimes(1)
      finish({})
      await vi.waitFor(() => expect(wrapper.find('button').exists()).toBe(false))
    })

    it('shows a 403 as a permission error', async () => {
      vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(403, 'This action is unauthorized.'))
      const wrapper = mountActions(opened)
      await wrapper.find('button[name=resolve]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[role=alert]').text()).toBe('You are not allowed to change this log group.'))
    })

    it('shows the 422 message from the API', async () => {
      vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(422, 'Invalid.', { status: ['The selected status is invalid.'] }))
      const wrapper = mountActions(opened)
      await wrapper.find('button[name=ignore]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[role=alert]').text()).toBe('The selected status is invalid.'))
    })

    it('falls back to the requested status when the response status is unknown', async () => {
      vi.spyOn(api, 'patch').mockResolvedValue({ data: logGroup('archived') })
      const wrapper = mountActions(opened)
      await wrapper.find('button[name=resolve]').trigger('click')
      await vi.waitFor(() => expect(wrapper.text()).toContain('Marked as resolved'))
      expect(wrapper.text()).not.toContain('archived')
    })

    it('shows the status from the response over the requested one in the confirmation', async () => {
      vi.spyOn(api, 'patch').mockResolvedValue({ data: logGroup('ignored') })
      const wrapper = mountActions(opened)
      await wrapper.find('button[name=resolve]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('button').exists()).toBe(false))
      expect(wrapper.text()).toContain('Marked as ignored')
      i18n.global.locale.value = 'es'
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('Marcado como ignorado')
    })

    it('falls back to the requested status when the response has none', async () => {
      vi.spyOn(api, 'patch').mockResolvedValue({})
      const wrapper = mountActions(opened)
      await wrapper.find('button[name=resolve]').trigger('click')
      await vi.waitFor(() => expect(wrapper.text()).toContain('Marked as resolved'))
    })

    it('shows the generic error for a 404', async () => {
      vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(404, 'Not found.'))
      const wrapper = mountActions(opened)
      await wrapper.find('button[name=resolve]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[role=alert]').text()).toBe('Could not update the log group.'))
      expect(wrapper.find('button[name=resolve]').exists()).toBe(true)
    })

    it('shows a generic error for other failures and clears it on retry', async () => {
      const patch = vi.spyOn(api, 'patch').mockRejectedValueOnce(new ApiError(0, 'network'))
      const wrapper = mountActions(opened)
      await wrapper.find('button[name=resolve]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[role=alert]').text()).toBe('Could not update the log group.'))
      patch.mockResolvedValue({})
      await wrapper.find('button[name=resolve]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[role=alert]').exists()).toBe(false))
    })
  })
})
