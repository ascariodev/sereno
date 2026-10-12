export interface TextEdit {
  value: string
  selectionStart: number
  selectionEnd: number
}

export type LineFormat = 'heading' | 'bullet' | 'numbered' | 'quote'

const LINE_PATTERNS: Record<LineFormat, RegExp> = {
  heading: /^## /,
  bullet: /^[-*+] /,
  numbered: /^\d+\. /,
  quote: /^> ?/,
}

const ANY_HEADING = /^#{1,6} /
const ANY_BLOCK_PREFIX = /^(?:[-*+] |\d+\. |> ?)/
const LINK_PLACEHOLDER = 'https://'

function splice(value: string, start: number, end: number, insert: string): string {
  return value.slice(0, start) + insert + value.slice(end)
}

export function wrapSelection(value: string, start: number, end: number, marker: string): TextEdit {
  const size = marker.length
  const selected = value.slice(start, end)

  if (start >= size && value.slice(start - size, start) === marker && value.slice(end, end + size) === marker) {
    return {
      value: splice(value, start - size, end + size, selected),
      selectionStart: start - size,
      selectionEnd: end - size,
    }
  }

  if (selected.length >= size * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(size, selected.length - size)
    return { value: splice(value, start, end, inner), selectionStart: start, selectionEnd: start + inner.length }
  }

  return {
    value: splice(value, start, end, marker + selected + marker),
    selectionStart: start + size,
    selectionEnd: end + size,
  }
}

export function formatLines(value: string, start: number, end: number, format: LineFormat): TextEdit {
  const blockStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
  const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end
  const newlineAfter = value.indexOf('\n', effectiveEnd)
  const blockEnd = newlineAfter === -1 ? value.length : newlineAfter

  const lines = value.slice(blockStart, blockEnd).split('\n')
  const pattern = LINE_PATTERNS[format]
  const nonBlank = lines.filter((line) => line.trim() !== '')
  const targets = nonBlank.length > 0 ? nonBlank : lines
  const remove = targets.every((line) => pattern.test(line))

  let counter = 0
  const formatted = lines.map((line) => {
    if (!targets.includes(line)) return line
    if (remove) return line.replace(pattern, '')
    const body = line.replace(format === 'heading' ? ANY_HEADING : ANY_BLOCK_PREFIX, '')
    counter += 1
    if (format === 'heading') return `## ${body}`
    if (format === 'bullet') return `- ${body}`
    if (format === 'numbered') return `${counter}. ${body}`
    return `> ${body}`
  })

  const block = formatted.join('\n')
  const next = splice(value, blockStart, blockEnd, block)

  if (start === end) {
    const delta = formatted[0].length - lines[0].length
    const cursor = Math.max(blockStart, start + delta)
    return { value: next, selectionStart: cursor, selectionEnd: cursor }
  }
  return { value: next, selectionStart: blockStart, selectionEnd: blockStart + block.length }
}

export function toggleLink(value: string, start: number, end: number): TextEdit {
  const selected = value.slice(start, end)
  const existing = /^\[([^\]]*)\]\([^)]*\)$/.exec(selected)
  if (existing) {
    const label = existing[1]
    return { value: splice(value, start, end, label), selectionStart: start, selectionEnd: start + label.length }
  }

  if (selected === '') {
    return {
      value: splice(value, start, end, `[](${LINK_PLACEHOLDER})`),
      selectionStart: start + 1,
      selectionEnd: start + 1,
    }
  }

  const urlStart = start + selected.length + 3
  return {
    value: splice(value, start, end, `[${selected}](${LINK_PLACEHOLDER})`),
    selectionStart: urlStart,
    selectionEnd: urlStart + LINK_PLACEHOLDER.length,
  }
}

export function toggleCode(value: string, start: number, end: number): TextEdit {
  const selected = value.slice(start, end)
  const fenced = /^```\n([\s\S]*)\n```$/.exec(selected)
  if (fenced) {
    return {
      value: splice(value, start, end, fenced[1]),
      selectionStart: start,
      selectionEnd: start + fenced[1].length,
    }
  }

  if (selected.includes('\n')) {
    return {
      value: splice(value, start, end, `\`\`\`\n${selected}\n\`\`\``),
      selectionStart: start + 4,
      selectionEnd: start + 4 + selected.length,
    }
  }

  return wrapSelection(value, start, end, '`')
}
