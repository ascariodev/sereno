import { afterEach, describe, expect, it } from 'vitest'
import en from './en.json'
import es from './es.json'
import { getLocale, resolveLocale, setLocale } from './index'

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
