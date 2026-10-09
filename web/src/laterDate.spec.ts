import { describe, expect, it } from 'vitest'
import { laterDate } from './laterDate'

describe('laterDate', () => {
  it('handles nulls', () => {
    expect(laterDate(null, null)).toBeNull()
    expect(laterDate(null, '2026-01-01T10:00:00Z')).toBe('2026-01-01T10:00:00Z')
    expect(laterDate('2026-01-01T10:00:00Z', null)).toBe('2026-01-01T10:00:00Z')
  })

  it('compares instants, not strings', () => {
    expect(laterDate('2026-01-01T10:00:00Z', '2026-01-01T10:00:00.500000Z')).toBe('2026-01-01T10:00:00.500000Z')
    expect(laterDate('2026-01-01T11:00:00+01:00', '2026-01-01T10:30:00Z')).toBe('2026-01-01T10:30:00Z')
  })
})
