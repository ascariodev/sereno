import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

const MAX_HEADING_LEVEL = 4
const HEADING_OFFSET = 2

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

md.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx]
  const level = Math.min(Number(token.tag.slice(1)) + HEADING_OFFSET, MAX_HEADING_LEVEL)
  token.tag = `h${level}`
  return self.renderToken(tokens, idx, options)
}
md.renderer.rules.heading_close = (tokens, idx, options, _env, self) => {
  tokens[idx].tag = tokens[idx - 2].tag
  return self.renderToken(tokens, idx, options)
}

md.renderer.rules.s_open = () => '<del>'
md.renderer.rules.s_close = () => '</del>'

const purifier = DOMPurify(window)

purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a',
    'h1', 'h2', 'h3', 'h4', 'hr',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
}

export function renderMarkdown(source: string): string {
  if (!source) return ''
  return purifier.sanitize(md.render(source), SANITIZE_CONFIG)
}
