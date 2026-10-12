import { describe, expect, it } from 'vitest'
import { renderMarkdown, sanitizeHtml } from './renderMarkdown'

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

  describe('task list', () => {
    const boxes = (html: string) => Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('input'))

    it('renders checkboxes disabled with the source line and an accessible name', () => {
      const [open, done] = boxes(renderMarkdown('- [ ] write **docs**\n- [x] ship'))
      expect(open.type).toBe('checkbox')
      expect(open.disabled).toBe(true)
      expect(open.checked).toBe(false)
      expect(open.dataset.taskLine).toBe('0')
      expect(open.getAttribute('aria-label')).toBe('write docs')
      expect(done.checked).toBe(true)
      expect(done.dataset.taskLine).toBe('1')
      expect(renderMarkdown('- [ ] a')).not.toContain('[ ]')
    })

    it('omits disabled when interactive', () => {
      expect(boxes(renderMarkdown('- [ ] a', { interactive: true }))[0].disabled).toBe(false)
    })

    it('ignores brackets outside a list item or inside code', () => {
      expect(boxes(renderMarkdown('[ ] loose\n\n```\n- [ ] code\n```\n\n- plain [ ] text'))).toHaveLength(0)
    })

    it('never lets other inputs through', () => {
      expect(renderMarkdown('<input type="text" value="x">')).not.toContain('<input')
      expect(renderMarkdown('<input type="checkbox" data-task-line="1">')).not.toContain('<input')
    })
    it('keeps the label intact with quotes, angle brackets and ampersands, and adds no attributes', () => {
      const [box] = boxes(renderMarkdown('- [ ] a" onfocus="x <b> & c'))
      expect(box.getAttribute('aria-label')).toBe('a" onfocus="x <b> & c')
      expect(box.getAttributeNames().sort()).toEqual(['aria-label', 'data-task-line', 'disabled', 'type'])
    })

    describe('sanitizer', () => {
      const parse = (html: string) => new DOMParser().parseFromString(sanitizeHtml(html), 'text/html')

      it('drops inputs that are not checkboxes', () => {
        expect(parse('<input type="text" data-task-line="1">').querySelector('input')).toBeNull()
        expect(parse('<input data-task-line="1">').querySelector('input')).toBeNull()
      })

      it('drops a checkbox without a numeric source line', () => {
        expect(parse('<input type="checkbox">').querySelector('input')).toBeNull()
        expect(parse('<input type="checkbox" data-task-line="a" formaction="x">').querySelector('input')).toBeNull()
      })

      it('keeps a valid checkbox without extra attributes', () => {
        const box = parse('<input type="checkbox" data-task-line="2" formaction="x" name="n" value="v">').querySelector('input')!
        expect(box.getAttributeNames().sort()).toEqual(['data-task-line', 'type'])
      })

      it('strips task attributes from other elements', () => {
        const p = parse('<p aria-label="x" data-task-line="1">t</p>').querySelector('p')!
        expect(p.hasAttribute('aria-label')).toBe(false)
        expect(p.hasAttribute('data-task-line')).toBe(false)
      })
    })
  })
})
