import { getLocales } from 'expo-localization'
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'

import { api } from '@/api/client'

import en from './en.json'
import es from './es.json'

export const SUPPORTED_LOCALES = ['en', 'es'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_LABELS: Record<Locale, string> = { es: 'Español', en: 'English' }

const DEFAULT_LOCALE: Locale = 'en'

function toSupported(tag: string | null | undefined): Locale | null {
  const base = tag?.toLowerCase().split(/[-_]/)[0]
  return SUPPORTED_LOCALES.find((locale) => locale === base) ?? null
}

export function resolveLocale(
  userLocale?: string | null,
  systemLanguages: readonly (string | null | undefined)[] = [],
): Locale {
  const fromUser = toSupported(userLocale)
  if (fromUser) return fromUser
  for (const language of systemLanguages) {
    const fromSystem = toSupported(language)
    if (fromSystem) return fromSystem
  }
  return DEFAULT_LOCALE
}

let chosenLocale: Locale | null = null

export function setChosenLocale(locale: string | null): void {
  chosenLocale = toSupported(locale)
}

function preferredLanguages(): string[] {
  const system = getLocales().map((locale) => locale.languageTag)
  return chosenLocale ? [chosenLocale, ...system] : system
}

export const i18n = createInstance()

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: resolveLocale(null, preferredLanguages()),
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})

export function getLocale(): Locale {
  return resolveLocale(i18n.language)
}

export function setLocale(userLocale?: string | null): Locale {
  const locale = resolveLocale(userLocale, preferredLanguages())
  void i18n.changeLanguage(locale)
  return locale
}

export function chooseLocale(locale: Locale): Locale {
  setChosenLocale(locale)
  return setLocale(locale)
}

export function installI18nOnApi(): void {
  api.setLocaleProvider(getLocale)
}
