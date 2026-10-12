import { taskItemLines } from './renderMarkdown'

const TASK_LINE = /^((?:\s*(?:>|[-*+]|\d{1,9}[.)]))+\s+)\[([ xX])\]/

export function toggleTaskItem(source: string, lineIndex: number): string {
  if (!taskItemLines(source).has(lineIndex)) return source
  const parts = source.split(/(\r\n|\r|\n)/)
  const at = lineIndex * 2
  const match = TASK_LINE.exec(parts[at] ?? '')
  if (!match) return source
  parts[at] = parts[at].replace(TASK_LINE, `${match[1]}[${match[2] === ' ' ? 'x' : ' '}]`)
  return parts.join('')
}
