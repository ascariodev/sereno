import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import { splitMentions } from '../mentionToken'

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

export interface MentionOptions {
  mentions: readonly { id: number; name: string }[]
  unknownLabel: string
  ownUserId?: number
}

const ESCAPED_MENTION = /^\\(<@[1-9][0-9]{0,17}>)/

md.inline.ruler.before('escape', 'escaped_mention', (state, silent) => {
  const match = ESCAPED_MENTION.exec(state.src.slice(state.pos))
  if (!match) return false
  if (!silent) state.push('escaped_mention', '', 0).content = match[1]
  state.pos += match[0].length
  return true
})

md.renderer.rules.escaped_mention = (tokens, idx) => md.utils.escapeHtml(tokens[idx].content)

md.core.ruler.after('inline', 'mentions', (state) => {
  const options = state.env?.mentions as MentionOptions | undefined
  if (!options) return
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue
    const children: typeof block.children = []
    for (const child of block.children) {
      if (child.type !== 'text' || !child.content.includes('<@')) {
        children.push(child)
        continue
      }
      for (const part of splitMentions(child.content, options.mentions, options.unknownLabel, options.ownUserId)) {
        if ('text' in part) {
          const t = new state.Token('text', '', 0)
          t.content = part.text
          children.push(t)
          continue
        }
        const chip = new state.Token('html_inline', '', 0)
        chip.content =
          `<span class="mention-chip${part.own ? ' mention-chip--own' : ''}" data-mention>` +
          `@${md.utils.escapeHtml(part.mention)}</span>`
        children.push(chip)
      }
    }
    block.children = children
  }
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
  const isChip =
    node.tagName === 'SPAN' &&
    node.hasAttribute('data-mention') &&
    ['mention-chip', 'mention-chip mention-chip--own'].includes(node.getAttribute('class') ?? '')
  if (!isChip) {
    node.removeAttribute('class')
    node.removeAttribute('data-mention')
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
    'h1', 'h2', 'h3', 'h4', 'hr', 'input', 'span',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'type', 'checked', 'disabled', 'data-task-line', 'aria-label', 'class', 'data-mention'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
}

export function sanitizeHtml(html: string): string {
  return purifier.sanitize(html, SANITIZE_CONFIG)
}

export function renderMarkdown(source: string, options: { interactive?: boolean; mentions?: MentionOptions } = {}): string {
  if (!source) return ''
  return sanitizeHtml(md.render(source, { interactive: options.interactive === true, mentions: options.mentions }))
}
