import { describe, expect, it } from 'vitest'
import { LOG_LEVELS, levelTone } from './logLevels'

describe('levelTone', () => {
  it.each(LOG_LEVELS)('keeps the known level %s', (level) => {
    expect(levelTone(level)).toBe(level)
  })

  it.each([['bogus'], [''], [null], [undefined]])('falls back to debug for %s', (level) => {
    expect(levelTone(level)).toBe('debug')
  })
})
