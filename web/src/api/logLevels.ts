export const LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']

export function levelTone(level: string | null | undefined): string {
  return level && LOG_LEVELS.includes(level) ? level : 'debug'
}
