import { afterEach, describe, expect, it } from 'vitest'
import { isDesktop } from './desktop'

describe('isDesktop', () => {
  afterEach(() => {
    delete (globalThis as { isTauri?: boolean }).isTauri
  })

  it('is false in a browser', () => {
    expect(isDesktop()).toBe(false)
  })

  it('is true when Tauri injects its global', () => {
    ;(globalThis as { isTauri?: boolean }).isTauri = true
    expect(isDesktop()).toBe(true)
  })
})
