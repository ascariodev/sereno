import { describe, expect, it } from 'vitest'
import { safeRedirect } from './safeRedirect'

describe('safeRedirect', () => {
  it.each([
    '//evil',
    '/\\evil',
    '/ok\\path',
    'https://evil.com',
    'https:',
    'channels/3',
    '',
    '/login',
    '/login?x',
    '/login#h',
    '/session-error',
    '/session-error?redirect=/',
  ])('rejects %j', (value) => {
    expect(safeRedirect(value)).toBeNull()
  })

  it.each([undefined, null, 3, ['/a']])('rejects non-string %j', (value) => {
    expect(safeRedirect(value)).toBeNull()
  })

  it('accepts a local path with query and hash', () => {
    expect(safeRedirect('/channels/3?a=1#m')).toBe('/channels/3?a=1#m')
  })

  it('accepts the OAuth consent path with its whole query', () => {
    const value = '/oauth/authorize?client_id=c&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=a+b'
    expect(safeRedirect(value)).toBe(value)
  })

  it('accepts the root', () => {
    expect(safeRedirect('/')).toBe('/')
  })
})
