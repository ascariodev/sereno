import { LOG_LEVELS } from '../api/logLevels'
import { TASK_DESCRIPTION_MAX_LENGTH, charCount } from './taskLimits'

type Translate = (key: string) => string

export interface LogGroupTaskData {
  level: string
  events_count: number
  message: string
  first_seen_at?: string | null
  last_seen_at?: string | null
}

function fenceFor(message: string): string {
  const longestRun = Math.max(0, ...(message.match(/`+/g) ?? []).map((run) => run.length))
  return '`'.repeat(Math.max(3, longestRun + 1))
}

function formatDate(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

export function buildLogGroupTaskDescription(data: LogGroupTaskData, t: Translate, locale: string): string {
  const level = LOG_LEVELS.includes(data.level) ? t(`notice.level.${data.level}`) : data.level
  const lines = [`- **${t('log.level.label')}:** ${level}`, `- **${t('logGroup.events')}:** ${data.events_count}`]
  if (data.first_seen_at) lines.push(`- **${t('logGroup.firstSeen')}:** ${formatDate(data.first_seen_at, locale)}`)
  if (data.last_seen_at) lines.push(`- **${t('logGroup.lastSeen')}:** ${formatDate(data.last_seen_at, locale)}`)
  const head = `${lines.join('\n')}\n\n`

  const build = (message: string) => {
    const fence = fenceFor(message)
    return `${head}${fence}\n${message}\n${fence}`
  }

  const full = build(data.message)
  const overflow = charCount(full) - TASK_DESCRIPTION_MAX_LENGTH
  if (overflow <= 0) return full

  const chars = [...data.message]
  const keep = Math.max(0, chars.length - overflow - 1)
  return build(`${chars.slice(0, keep).join('')}…`)
}
