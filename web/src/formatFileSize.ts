import { getLocale } from './i18n'

const UNITS = ['B', 'KB', 'MB', 'GB']

export function formatFileSize(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const formatted = new Intl.NumberFormat(getLocale(), {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value)
  return `${formatted} ${UNITS[unit]}`
}
