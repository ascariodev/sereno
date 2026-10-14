import { Monitor, Moon, Sun, type LucideIcon } from '@lucide/vue'
import type { ThemePreference } from './theme'

export const THEME_ICONS: Record<ThemePreference, LucideIcon> = { system: Monitor, light: Sun, dark: Moon }
