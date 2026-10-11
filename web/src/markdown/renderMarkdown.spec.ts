import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './renderMarkdown'

describe('renderMarkdown', () => {
  it('returns an empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('')
  })

  it('renders basic formatting', () => {
    const html = renderMarkdown('**bold** *italic* ~~gone~~ `code`')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<del>gone</del>')
    expect(html).toContain('<code>code</code>')
  })

  it('renders lists, quotes, code blocks and rules', () => {
    expect(renderMarkdown('- a\n- b')).toContain('<ul>')
    expect(renderMarkdown('1. a\n2. b')).toContain('<ol>')
    expect(renderMarkdown('> quote')).toContain('<blockquote>')
    expect(renderMarkdown('```\nx\n```')).toContain('<pre><code>')
    expect(renderMarkdown('---')).toContain('<hr>')
  })

  it('turns single newlines into br', () => {
    expect(renderMarkdown('a\nb')).toContain('a<br>')
  })

  it('demotes headings so h1 becomes h3 and none exceeds h4', () => {
    expect(renderMarkdown('# T')).toBe('<h3>T</h3>\n')
    expect(renderMarkdown('## T')).toBe('<h4>T</h4>\n')
    expect(renderMarkdown('###### T')).toBe('<h4>T</h4>\n')
  })

  it('opens links in a new tab safely, including linkified urls', () => {
    const html = renderMarkdown('[x](https://example.com) y https://example.org')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('href="https://example.org"')
    expect(html.match(/target="_blank"/g)).toHaveLength(2)
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2)
  })

  it('keeps mailto links', () => {
    expect(renderMarkdown('[m](mailto:a@b.co)')).toContain('href="mailto:a@b.co"')
  })

  it('escapes raw html and script tags', () => {
    const html = renderMarkdown('<script>alert(1)</script> hi')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it('does not let img onerror through', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).not.toMatch(/<[^>]*onerror/)
  })

  it('drops markdown images', () => {
    expect(renderMarkdown('![a](https://example.com/a.png)')).not.toContain('<img')
  })

  it('does not render javascript: links as anchors', () => {
    const html = renderMarkdown('[x](javascript:alert(1))')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('href')
  })

  it('does not render data: links as anchors', () => {
    const html = renderMarkdown('[x](data:text/html;base64,PHNjcmlwdD4=)')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('href')
  })

  it('strips disallowed schemes even in mixed case or entities', () => {
    expect(renderMarkdown('[x](JaVaScRiPt:alert(1))')).not.toContain('href')
    expect(renderMarkdown('[x](&#106;avascript:alert(1))')).not.toContain('href')
  })
})
