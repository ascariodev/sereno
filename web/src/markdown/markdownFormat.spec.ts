import { describe, expect, it } from 'vitest'
import { formatLines, toggleCode, toggleLink, wrapSelection } from './markdownFormat'

describe('wrapSelection', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(wrapSelection('say hello now', 4, 9, '**')).toEqual({
      value: 'say **hello** now',
      selectionStart: 6,
      selectionEnd: 11,
    })
  })

  it('inserts the markers around an empty selection with the cursor between them', () => {
    expect(wrapSelection('ab', 1, 1, '_')).toEqual({ value: 'a__b', selectionStart: 2, selectionEnd: 2 })
  })

  it('wraps a multiline selection as a whole', () => {
    expect(wrapSelection('a\nb', 0, 3, '**').value).toBe('**a\nb**')
  })

  it('undoes the format when the markers surround the selection', () => {
    expect(wrapSelection('say **hello** now', 6, 11, '**')).toEqual({
      value: 'say hello now',
      selectionStart: 4,
      selectionEnd: 9,
    })
  })

  it('undoes the format when the selection includes the markers', () => {
    expect(wrapSelection('say **hello** now', 4, 13, '**')).toEqual({
      value: 'say hello now',
      selectionStart: 4,
      selectionEnd: 9,
    })
  })

  it('undoes empty markers around the cursor', () => {
    expect(wrapSelection('a____b', 3, 3, '_').value).toBe('a__b')
  })
})

describe('formatLines', () => {
  it('prefixes the line of a collapsed cursor and moves the cursor with it', () => {
    expect(formatLines('one\ntwo', 5, 5, 'bullet')).toEqual({
      value: 'one\n- two',
      selectionStart: 7,
      selectionEnd: 7,
    })
  })

  it('prefixes every non-empty line of a multiline selection', () => {
    expect(formatLines('a\n\nb', 0, 4, 'bullet').value).toBe('- a\n\n- b')
  })

  it('numbers the lines in order', () => {
    expect(formatLines('a\nb\nc', 0, 5, 'numbered').value).toBe('1. a\n2. b\n3. c')
  })

  it('quotes the lines', () => {
    expect(formatLines('a\nb', 0, 3, 'quote').value).toBe('> a\n> b')
  })

  it('removes the prefix when every line already has it', () => {
    expect(formatLines('- a\n- b', 0, 7, 'bullet').value).toBe('a\nb')
    expect(formatLines('1. a\n2. b', 0, 9, 'numbered').value).toBe('a\nb')
    expect(formatLines('> a', 0, 3, 'quote').value).toBe('a')
  })

  it('adds the prefix to all lines when only some have it', () => {
    expect(formatLines('- a\nb', 0, 5, 'bullet').value).toBe('- a\n- b')
  })

  it('replaces an existing heading level and toggles it off', () => {
    expect(formatLines('# Title', 0, 0, 'heading').value).toBe('## Title')
    expect(formatLines('## Title', 0, 0, 'heading').value).toBe('Title')
  })

  it('switches between block types without stacking prefixes', () => {
    expect(formatLines('- a', 0, 3, 'numbered').value).toBe('1. a')
    expect(formatLines('1. a', 0, 4, 'bullet').value).toBe('- a')
    expect(formatLines('> a', 0, 3, 'bullet').value).toBe('- a')
  })

  it('works on an empty document', () => {
    expect(formatLines('', 0, 0, 'bullet')).toEqual({ value: '- ', selectionStart: 2, selectionEnd: 2 })
  })

  it('ignores the line after a selection that ends at a line break', () => {
    expect(formatLines('a\nb\nc', 0, 4, 'bullet').value).toBe('- a\n- b\nc')
  })
})

describe('toggleLink', () => {
  it('links the selection and selects the url placeholder', () => {
    expect(toggleLink('see docs', 4, 8)).toEqual({
      value: 'see [docs](https://)',
      selectionStart: 11,
      selectionEnd: 19,
    })
  })

  it('inserts an empty link with the cursor in the label', () => {
    expect(toggleLink('x', 1, 1)).toEqual({ value: 'x[](https://)', selectionStart: 2, selectionEnd: 2 })
  })

  it('removes the link and keeps its label', () => {
    expect(toggleLink('see [docs](https://a.b)', 4, 23)).toEqual({
      value: 'see docs',
      selectionStart: 4,
      selectionEnd: 8,
    })
  })
})

describe('toggleCode', () => {
  it('uses inline code for a single line and undoes it', () => {
    const inline = toggleCode('run ls now', 4, 6)
    expect(inline.value).toBe('run `ls` now')
    expect(toggleCode(inline.value, inline.selectionStart, inline.selectionEnd).value).toBe('run ls now')
  })

  it('fences a multiline selection and undoes it', () => {
    const fenced = toggleCode('a\nb', 0, 3)
    expect(fenced).toEqual({ value: '```\na\nb\n```', selectionStart: 4, selectionEnd: 7 })
    expect(toggleCode(fenced.value, 0, fenced.value.length).value).toBe('a\nb')
  })
})
