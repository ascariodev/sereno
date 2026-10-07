import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { Message, MessagePayload } from '../api/types'
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

function textIn(locale: 'en' | 'es', msg: Message): string {
  i18n.global.locale.value = locale
  return mount(SystemNotice, { props: { message: msg }, global: { plugins: [i18n] } }).text()
}

describe('SystemNotice', () => {
  afterEach(() => {
    i18n.global.locale.value = 'en'
  })

  const opened = { type: 'log.group_opened', log_group_id: 5, level: 'error', title: 'Boom', events_count: 1 }
  const reopened = { type: 'log.group_reopened', log_group_id: 5, level: 'critical', title: 'Boom', events_count: 3 }
  const changed = { type: 'log.group_status_changed', log_group_id: 5, status: 'resolved', previous_status: 'open' }
  const ana = { id: 1, name: 'Ana' }

  it('renders log.group_opened', () => {
    expect(textIn('en', message(opened))).toBe('New log group (error): Boom (1 event)')
    expect(textIn('es', message(opened))).toBe('Nuevo grupo de logs (error): Boom (1 evento)')
  })

  it('renders log.group_reopened with plural events', () => {
    expect(textIn('en', message(reopened))).toBe('Log group reopened (critical): Boom (3 events)')
    expect(textIn('es', message(reopened))).toBe('Grupo de logs reabierto (crítico): Boom (3 eventos)')
  })

  it('renders log.group_status_changed with the actor', () => {
    expect(textIn('en', message(changed, ana))).toBe('Ana marked the log group as resolved')
    expect(textIn('es', message(changed, ana))).toBe('Ana marcó el grupo de logs como resuelto')
    expect(textIn('en', message(changed))).toBe('Someone marked the log group as resolved')
  })

  it('shows unknown levels and statuses as they come', () => {
    expect(textIn('en', message({ ...opened, level: 'verbose' }))).toContain('(verbose)')
    expect(textIn('en', message({ ...changed, status: 'archived' }, ana))).toContain('as archived')
  })

  it('falls back to the generic notice for an unknown or missing type', () => {
    expect(textIn('en', message({ type: 'something.new' }))).toBe('System notice')
    expect(textIn('es', message(null))).toBe('Aviso del sistema')
  })
})
