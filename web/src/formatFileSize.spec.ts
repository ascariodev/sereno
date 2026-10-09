import { describe, expect, it } from 'vitest'
import { formatFileSize } from './formatFileSize'

describe('formatFileSize', () => {
  it('formats bytes, KB and MB', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1023)).toBe('1,023 B')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB')
  })

  it('moves to the next unit when rounding reaches 1024', () => {
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1 MB')
    expect(formatFileSize(1024 * 1024 * 1024 - 1)).toBe('1 GB')
  })
})
