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

interface TokenLike {
  type: string
  content: string
  map: [number, number] | null
  children: TokenLike[] | null
}

const TASK_MARKER = /^\[([ xX])\](?:\s+|$)/

function taskInline(tokens: TokenLike[], idx: number): TokenLike | null {
  const inline = tokens[idx + 2]
  if (tokens[idx].type !== 'list_item_open' || inline?.type !== 'inline' || tokens[idx].map === null) return null
  return TASK_MARKER.test(inline.content) ? inline : null
}

function plainText(inline: TokenLike): string {
  return (inline.children ?? [])
    .map((child) => (child.type === 'text' || child.type === 'code_inline' ? child.content : ''))
    .join('')
    .trim()
}

md.core.ruler.after('inline', 'task_list', (state) => {
  const interactive = state.env?.interactive === true
  const tokens = state.tokens
  tokens.forEach((token, idx) => {
    const inline = taskInline(tokens, idx)
    if (!inline || !inline.children) return
    token.meta = { ...token.meta, task: true }
    const checked = TASK_MARKER.exec(inline.content)![1] !== ' '
    const first = inline.children[0]
    first.content = first.content.replace(TASK_MARKER, '')
    inline.content = inline.content.replace(TASK_MARKER, '')
    const label = md.utils.escapeHtml(plainText(inline))
    const box = new state.Token('html_inline', '', 0)
    box.content =
      `<input type="checkbox" data-task-line="${token.map![0]}"` +
      `${checked ? ' checked' : ''}${interactive ? '' : ' disabled'}${label ? ` aria-label="${label}"` : ''}> `
    inline.children.unshift(box)
  })
})

export function taskItemLines(source: string): Set<number> {
  const tokens = md.parse(source, {})
  const lines = new Set<number>()
  tokens.forEach((token) => {
    if (token.type === 'list_item_open' && token.meta?.task === true) lines.add(token.map![0])
  })
  return lines
}

const purifier = DOMPurify(window)

purifier.addHook('uponSanitizeAttribute', (node, data) => {
  if (node.tagName === 'INPUT' && data.attrName === 'type' && data.attrValue === 'checkbox') data.forceKeepAttr = true
})

purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
  if (node.tagName === 'INPUT') {
    const line = node.getAttribute('data-task-line')
    if (node.getAttribute('type') !== 'checkbox' || !/^\d+$/.test(line ?? '')) node.remove()
  } else {
    node.removeAttribute('aria-label')
    node.removeAttribute('data-task-line')
  }
})

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a',
    'h1', 'h2', 'h3', 'h4', 'hr', 'input',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'type', 'checked', 'disabled', 'data-task-line', 'aria-label'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
}

export function sanitizeHtml(html: string): string {
  return purifier.sanitize(html, SANITIZE_CONFIG)
}

export function renderMarkdown(source: string, options: { interactive?: boolean } = {}): string {
  if (!source) return ''
  return sanitizeHtml(md.render(source, { interactive: options.interactive === true }))
}
