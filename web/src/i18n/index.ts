import { createI18n } from 'vue-i18n'
import { api } from '../api/client'
import en from './en.json'
import es from './es.json'

export const SUPPORTED_LOCALES = ['en', 'es'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_LABELS: Record<Locale, string> = { es: 'Español', en: 'English' }

const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_STORAGE_KEY = 'workspace.locale'

export function readStoredLocale(): Locale | null {
  try {
    return toSupported(localStorage.getItem(LOCALE_STORAGE_KEY))
  } catch {
    return null
  }
}

function writeStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // storage unavailable: the choice only lasts for this page load
  }
}

function preferredLanguages(): string[] {
  const stored = readStoredLocale()
  const browser = typeof navigator === 'undefined' ? [] : navigator.languages
  return stored ? [stored, ...browser] : [...browser]
}

function toSupported(tag: string | null | undefined): Locale | null {
  const base = tag?.toLowerCase().split(/[-_]/)[0]
  return SUPPORTED_LOCALES.find((locale) => locale === base) ?? null
}

export function resolveLocale(
  userLocale?: string | null,
  browserLanguages: readonly string[] = [],
): Locale {
  const fromUser = toSupported(userLocale)
  if (fromUser) return fromUser
  for (const language of browserLanguages) {
    const fromBrowser = toSupported(language)
    if (fromBrowser) return fromBrowser
  }
  return DEFAULT_LOCALE
}

export const i18n = createI18n({
  legacy: false,
  locale: resolveLocale(null, preferredLanguages()),
  fallbackLocale: DEFAULT_LOCALE,
  messages: { en, es },
})

export function getLocale(): Locale {
  return i18n.global.locale.value as Locale
}

function syncDocumentLang(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}

syncDocumentLang(getLocale())

export function setLocale(userLocale?: string | null): Locale {
  const locale = resolveLocale(userLocale, preferredLanguages())
  i18n.global.locale.value = locale
  syncDocumentLang(locale)
  return locale
}

export function chooseLocale(locale: Locale): Locale {
  writeStoredLocale(locale)
  return setLocale(locale)
}

export function installI18nOnApi(): void {
  api.setLocaleProvider(getLocale)
}
