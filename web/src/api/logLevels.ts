const LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'] as const

export type LogLevel = (typeof LEVELS)[number]

export const LOG_LEVELS: readonly string[] = LEVELS

export function levelTone(level: string | null | undefined): string {
  return level && LOG_LEVELS.includes(level) ? level : 'debug'
}
