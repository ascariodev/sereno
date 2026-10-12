import { describe, expect, it } from 'vitest'
import { toggleTaskItem } from './toggleTaskItem'

describe('toggleTaskItem', () => {
  it('toggles only the requested checkbox', () => {
    const source = '- [ ] a\n- [x] b\n- [ ] c'
    expect(toggleTaskItem(source, 0)).toBe('- [x] a\n- [x] b\n- [ ] c')
    expect(toggleTaskItem(source, 1)).toBe('- [ ] a\n- [ ] b\n- [ ] c')
    expect(toggleTaskItem(source, 2)).toBe('- [ ] a\n- [x] b\n- [x] c')
  })

  it('handles numbered, nested and quoted items', () => {
    expect(toggleTaskItem('1. [ ] a\n   - [ ] b\n> - [ ] c', 1)).toBe('1. [ ] a\n   - [x] b\n> - [ ] c')
    expect(toggleTaskItem('> - [ ] c', 0)).toBe('> - [x] c')
  })

  it('ignores checkboxes inside code blocks', () => {
    const source = '```\n- [ ] code\n```\n- [ ] real'
    expect(toggleTaskItem(source, 1)).toBe(source)
    expect(toggleTaskItem(source, 3)).toBe('```\n- [ ] code\n```\n- [x] real')
  })

  it('keeps CRLF line endings', () => {
    expect(toggleTaskItem('- [ ] a\r\n- [ ] b\r\n', 1)).toBe('- [ ] a\r\n- [x] b\r\n')
  })

  it('treats a lone CR as a line break like the renderer', () => {
    expect(toggleTaskItem('- [ ] a\r- [ ] b', 1)).toBe('- [ ] a\r- [x] b')
    expect(toggleTaskItem('- [ ] a\r\n- [ ] b\r- [ ] c', 2)).toBe('- [ ] a\r\n- [ ] b\r- [x] c')
  })

  it('returns the source unchanged for lines that are not task items', () => {
    const source = '- [ ] a\ntext'
    expect(toggleTaskItem(source, 1)).toBe(source)
    expect(toggleTaskItem(source, 9)).toBe(source)
    expect(toggleTaskItem('', 0)).toBe('')
  })
})
