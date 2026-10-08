import { afterEach, describe, expect, it, vi } from 'vitest'
import en from './en.json'
import es from './es.json'
import { chooseLocale, getLocale, LOCALE_STORAGE_KEY, resolveLocale, setLocale } from './index'

function flatten(tree: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  return Object.entries(tree).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object') {
      Object.assign(acc, flatten(value as Record<string, unknown>, path))
    } else {
      acc[path] = value
    }
    return acc
  }, {})
}

describe('resolveLocale', () => {
  it('prefers the user locale over the browser', () => {
    expect(resolveLocale('es', ['en-US'])).toBe('es')
    expect(resolveLocale('en', ['es-MX'])).toBe('en')
  })

  it('falls back to the first supported browser language', () => {
    expect(resolveLocale(null, ['fr-FR', 'es-MX', 'en'])).toBe('es')
    expect(resolveLocale(undefined, ['en-GB'])).toBe('en')
  })

  it('ignores unsupported user locales and falls back to en', () => {
    expect(resolveLocale('fr', ['es'])).toBe('es')
    expect(resolveLocale('fr', ['de'])).toBe('en')
    expect(resolveLocale(null, [])).toBe('en')
  })
})

describe('setLocale', () => {
  afterEach(() => {
    setLocale('en')
  })

  it('updates the active locale', () => {
    expect(setLocale('es')).toBe('es')
    expect(getLocale()).toBe('es')
    setLocale('en')
    expect(getLocale()).toBe('en')
  })

  it('keeps document lang in sync', () => {
    setLocale('es')
    expect(document.documentElement.lang).toBe('es')
    setLocale('en')
    expect(document.documentElement.lang).toBe('en')
  })
})

describe('stored choice', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    setLocale('en')
  })

  it('chooseLocale saves and applies the locale', () => {
    expect(chooseLocale('es')).toBe('es')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es')
    expect(getLocale()).toBe('es')
  })

  it('applies the stored choice when there is no user locale, but the user locale wins', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    expect(setLocale(null)).toBe('es')
    expect(setLocale('en')).toBe('en')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es')
  })

  it('ignores an invalid stored value', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'xx')
    expect(setLocale(null)).toBe('en')
  })

  it('survives a storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(setLocale(null)).toBe('en')
    expect(chooseLocale('es')).toBe('es')
  })
})

describe('startup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    document.documentElement.lang = ''
  })

  it('sets document lang from the browser language on load', async () => {
    vi.stubGlobal('navigator', { languages: ['es-MX'] })
    vi.resetModules()
    await import('./index')
    expect(document.documentElement.lang).toBe('es')
  })

  it('prefers the stored choice over the browser language on load', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    vi.stubGlobal('navigator', { languages: ['es-MX'] })
    vi.resetModules()
    await import('./index')
    expect(document.documentElement.lang).toBe('en')
    localStorage.clear()
  })
})

describe('translation files', () => {
  const enFlat = flatten(en)
  const esFlat = flatten(es)

  it('are not empty', () => {
    expect(Object.keys(enFlat).length).toBeGreaterThan(0)
    expect(Object.keys(esFlat).length).toBeGreaterThan(0)
  })

  it('have the same keys', () => {
    expect(Object.keys(esFlat).sort()).toEqual(Object.keys(enFlat).sort())
  })

  it('have no empty values', () => {
    for (const flat of [enFlat, esFlat]) {
      for (const value of Object.values(flat)) {
        expect(typeof value).toBe('string')
        expect((value as string).trim()).not.toBe('')
      }
    }
  })
})
