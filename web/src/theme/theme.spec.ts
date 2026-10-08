/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  THEME_STORAGE_KEY,
  applyTheme,
  initTheme,
  readThemePreference,
  saveThemePreference,
} from './theme'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  vi.restoreAllMocks()
})

describe('theme preference', () => {
  it('defaults to system when nothing is stored', () => {
    expect(readThemePreference()).toBe('system')
  })

  it('reads a stored valid value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(readThemePreference()).toBe('dark')
  })

  it('falls back to system on an invalid value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple')
    expect(readThemePreference()).toBe('system')
  })

  it('falls back to system when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readThemePreference()).toBe('system')
  })

  it('saves the preference and applies it', () => {
    saveThemePreference('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('still applies when saving fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full')
    })
    saveThemePreference('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('applies dark and light as data-theme and removes it for system', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('initTheme applies the stored preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(initTheme()).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('index.html inline script uses the same storage key', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    expect(html).toContain(`'${THEME_STORAGE_KEY}'`)
    expect(html).toContain(`setAttribute('data-theme'`)
    expect(html).toContain(`theme === 'light'`)
    expect(html).toContain(`theme === 'dark'`)
  })
})
