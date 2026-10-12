import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import en from '../i18n/en.json'
import es from '../i18n/es.json'
import { buildLogGroupTaskDescription } from './logGroupTaskDescription'
import { TASK_DESCRIPTION_MAX_LENGTH, charCount } from './taskLimits'

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en, es } })
const tFor = (locale: 'en' | 'es') => (key: string) => i18n.global.t(key, {}, { locale })

const FIRST = '2026-10-01T10:00:00Z'
const LAST = '2026-10-02T12:30:00Z'
const dateOf = (value: string, locale: string) =>
  new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })

describe('buildLogGroupTaskDescription', () => {
  it('builds the exact English template', () => {
    const out = buildLogGroupTaskDescription(
      { level: 'error', events_count: 3, message: 'Boom', first_seen_at: FIRST, last_seen_at: LAST },
      tFor('en'),
      'en',
    )
    expect(out).toBe(
      [
        '- **Level:** error',
        '- **Events:** 3',
        `- **First seen:** ${dateOf(FIRST, 'en')}`,
        `- **Last seen:** ${dateOf(LAST, 'en')}`,
        '',
        '```',
        'Boom',
        '```',
      ].join('\n'),
    )
  })

  it('builds the exact Spanish template', () => {
    const out = buildLogGroupTaskDescription(
      { level: 'critical', events_count: 1, message: 'Falla', first_seen_at: FIRST, last_seen_at: LAST },
      tFor('es'),
      'es',
    )
    expect(out).toBe(
      [
        `- **Nivel:** ${es.notice.level.critical}`,
        '- **Eventos:** 1',
        `- **Primera vez:** ${dateOf(FIRST, 'es')}`,
        `- **Última vez:** ${dateOf(LAST, 'es')}`,
        '',
        '```',
        'Falla',
        '```',
      ].join('\n'),
    )
  })

  it('omits dates when absent and keeps unknown levels raw', () => {
    const out = buildLogGroupTaskDescription({ level: 'weird', events_count: 2, message: 'm' }, tFor('en'), 'en')
    expect(out).toBe(['- **Level:** weird', '- **Events:** 2', '', '```', 'm', '```'].join('\n'))
  })

  it('uses a fence longer than the longest backtick run', () => {
    const out = buildLogGroupTaskDescription(
      { level: 'info', events_count: 1, message: 'a ```` b `` c' },
      tFor('en'),
      'en',
    )
    expect(out.endsWith('\n`````\na ```` b `` c\n`````')).toBe(true)
  })

  it('truncates long messages by characters without splitting surrogate pairs', () => {
    const out = buildLogGroupTaskDescription(
      { level: 'error', events_count: 1, message: '😀'.repeat(TASK_DESCRIPTION_MAX_LENGTH) },
      tFor('en'),
      'en',
    )
    expect(charCount(out)).toBeLessThanOrEqual(TASK_DESCRIPTION_MAX_LENGTH)
    expect(out.endsWith('…\n```')).toBe(true)
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/)
  })

  it('stays within the limit when truncating a message full of backticks', () => {
    const out = buildLogGroupTaskDescription(
      { level: 'error', events_count: 1, message: '`'.repeat(TASK_DESCRIPTION_MAX_LENGTH + 50) },
      tFor('en'),
      'en',
    )
    expect(charCount(out)).toBeLessThanOrEqual(TASK_DESCRIPTION_MAX_LENGTH)
  })
})
