export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'workspace.theme'

const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

function isThemePreference(value: unknown): value is ThemePreference {
  return PREFERENCES.includes(value as ThemePreference)
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement
  if (preference === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', preference)
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // storage unavailable: the preference only applies to this session
  }
  applyTheme(preference)
}

export function initTheme(): ThemePreference {
  const preference = readThemePreference()
  applyTheme(preference)
  return preference
}
