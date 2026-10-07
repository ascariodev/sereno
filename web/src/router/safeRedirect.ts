const EXCLUDED_PATHS = ['/login', '/session-error']

export function safeRedirect(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  const path = value.split(/[?#]/, 1)[0]
  if (EXCLUDED_PATHS.includes(path)) return null
  return value
}
