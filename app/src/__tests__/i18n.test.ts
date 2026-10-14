/* eslint-disable @typescript-eslint/no-require-imports */
import { getLocales } from 'expo-localization'

import en from '@/i18n/en.json'
import es from '@/i18n/es.json'

jest.mock('expo-localization', () => ({ getLocales: jest.fn() }))

const mockedGetLocales = getLocales as jest.Mock

function loadI18n(systemTag: string) {
  mockedGetLocales.mockReturnValue([{ languageTag: systemTag }])
  let mod!: typeof import('@/i18n')
  let isolatedApi!: typeof import('@/api/client').api
  jest.isolateModules(() => {
    mod = require('@/i18n')
    isolatedApi = require('@/api/client').api
  })
  return { ...mod, api: isolatedApi }
}

function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce<Record<string, unknown>>(
      (acc, [key, child]) => ({ ...acc, ...flatten(child, prefix ? `${prefix}.${key}` : key) }),
      {},
    )
  }
  return { [prefix]: value }
}

describe('locale selection', () => {
  it('starts in the system language', () => {
    const { getLocale, i18n } = loadI18n('es-AR')

    expect(getLocale()).toBe('es')
    expect(i18n.language).toBe('es')
  })

  it('falls back to en when the system language is unsupported', () => {
    expect(loadI18n('fr-FR').getLocale()).toBe('en')
  })

  it('changes language live and exposes it to the API client', () => {
    const { getLocale, setLocale, installI18nOnApi, i18n, api } = loadI18n('en-US')
    const spy = jest.spyOn(api, 'setLocaleProvider')
    installI18nOnApi()
    const provider = spy.mock.calls[0][0]!

    expect(provider()).toBe('en')
    setLocale('es')

    expect(getLocale()).toBe('es')
    expect(provider()).toBe('es')
    expect(i18n.language).toBe('es')
  })
})

describe('translation files', () => {
  it('has the same keys in es and en and no empty values', () => {
    const flatEn = flatten(en)
    const flatEs = flatten(es)

    expect(Object.keys(flatEn).length).toBeGreaterThan(0)
    expect(Object.keys(flatEs).sort()).toEqual(Object.keys(flatEn).sort())
    for (const [key, value] of [...Object.entries(flatEn), ...Object.entries(flatEs)]) {
      expect([key, typeof value === 'string' && value.trim() !== '']).toEqual([key, true])
    }
  })
})
