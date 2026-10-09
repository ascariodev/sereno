import { computed, readonly, ref, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'
import { mentionToken } from '../mentionToken'

export interface MentionCandidate {
  id: number
  name: string
}

/** A mention inserted in the display text: `text.slice(start, end)` is `@` + `name` (UTF-16 indices). */
export interface InsertedMention {
  id: number
  name: string
  start: number
  end: number
}

/** The `@` being typed before the caret: `start` is the index of `@`, `text` what follows up to the caret. */
export interface MentionQuery {
  start: number
  text: string
}

export interface MentionInputOptions<T extends MentionCandidate> {
  members: MaybeRefOrGetter<readonly T[]>
  excludeUserId?: MaybeRefOrGetter<number | null | undefined>
  limit?: number
}

const DEFAULT_LIMIT = 8
const MAX_QUERY_LENGTH = 50
/** What may precede `@` to open the list: whitespace or opening punctuation, never a word character (emails). */
const OPENERS = /[\s([{"'¿¡]/

export function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function findQuery(text: string, caret: number | null, mentions: readonly InsertedMention[]): MentionQuery | null {
  if (caret === null) return null
  const at = text.lastIndexOf('@', caret - 1)
  if (at < 0 || caret <= at) return null
  if (at > 0 && !OPENERS.test(text[at - 1])) return null
  const query = text.slice(at + 1, caret)
  if (query.length > MAX_QUERY_LENGTH || /^\s|[\r\n]/.test(query)) return null
  if (mentions.some((m) => (at >= m.start && at < m.end) || (caret > m.start && caret < m.end))) return null
  return { start: at, text: query }
}

/**
 * Moves the mentions after an edit from `previous` to `next` and drops the ones the edit touched. With the caret,
 * the changed region ends at it, so typing inside a mention is not mistaken for typing after it.
 */
function reconcile(
  previous: string,
  next: string,
  caret: number | null,
  mentions: readonly InsertedMention[],
): InsertedMention[] {
  if (previous === next) return [...mentions]
  const shortest = Math.min(previous.length, next.length)
  const commonPrefix = (cap: number): number => {
    let n = 0
    while (n < cap && previous[n] === next[n]) n++
    return n
  }
  const commonSuffix = (cap: number): number => {
    let n = 0
    while (n < cap && previous[previous.length - 1 - n] === next[next.length - 1 - n]) n++
    return n
  }
  let prefix: number
  let suffix: number
  if (caret === null) {
    prefix = commonPrefix(shortest)
    suffix = commonSuffix(shortest - prefix)
  } else {
    suffix = commonSuffix(Math.min(shortest, next.length - Math.min(caret, next.length)))
    prefix = commonPrefix(shortest - suffix)
  }
  const editStart = prefix
  const editEnd = previous.length - suffix
  const delta = next.length - previous.length
  const result: InsertedMention[] = []
  for (const mention of mentions) {
    let moved: InsertedMention | null = null
    if (mention.end <= editStart) moved = mention
    else if (mention.start >= editEnd) moved = { ...mention, start: mention.start + delta, end: mention.end + delta }
    if (moved && next.slice(moved.start, moved.end) === `@${moved.name}`) result.push(moved)
  }
  return result
}

export function useMentionInput<T extends MentionCandidate>(options: MentionInputOptions<T>) {
  const limit = options.limit ?? DEFAULT_LIMIT
  const text = ref('')
  const caret = ref<number | null>(null)
  const mentions = shallowRef<InsertedMention[]>([])
  const dismissedAt = ref<number | null>(null)

  const pending = computed(() => findQuery(text.value, caret.value, mentions.value))
  const query = computed(() => (pending.value && pending.value.start !== dismissedAt.value ? pending.value : null))

  const suggestions = computed<T[]>(() => {
    const current = query.value
    if (!current) return []
    const needle = normalizeForSearch(current.text)
    const excluded = toValue(options.excludeUserId)
    const first: T[] = []
    const rest: T[] = []
    for (const member of toValue(options.members)) {
      if (member.id === excluded) continue
      const name = normalizeForSearch(member.name)
      if (name.startsWith(needle)) first.push(member)
      else if (` ${name}`.includes(` ${needle}`)) rest.push(member)
    }
    return [...first, ...rest].slice(0, limit)
  })

  const serialized = computed(() => {
    let out = ''
    let last = 0
    for (const mention of mentions.value) {
      out += text.value.slice(last, mention.start) + mentionToken(mention.id)
      last = mention.end
    }
    return out + text.value.slice(last)
  })

  const length = computed(() => [...serialized.value].length)

  function clearStaleDismiss(): void {
    if (pending.value?.start !== dismissedAt.value) dismissedAt.value = null
  }

  /** Call on every input event (typing, deleting, pasting) with the new value and `selectionStart`. */
  function update(next: string, nextCaret: number | null = null): void {
    mentions.value = reconcile(text.value, next, nextCaret, mentions.value)
    text.value = next
    caret.value = nextCaret
    clearStaleDismiss()
  }

  /** Call when the caret moves without editing; pass `end` so a non-empty selection closes the suggestions. */
  function moveCaret(start: number | null, end: number | null = start): void {
    caret.value = start !== null && start === end ? start : null
    clearStaleDismiss()
  }

  /** Replaces the `@query` before the caret with `@Name ` and returns the new caret, or null without a query. */
  function select(member: T): number | null {
    const current = query.value
    const at = caret.value
    if (!current || at === null) return null
    const label = `@${member.name}`
    const after = text.value.slice(at)
    const spacer = /^[ \t]/.test(after) ? '' : ' '
    const delta = label.length + spacer.length - (at - current.start)
    const inserted: InsertedMention = { id: member.id, name: member.name, start: current.start, end: current.start + label.length }
    const shifted = mentions.value.map((m) => (m.start >= at ? { ...m, start: m.start + delta, end: m.end + delta } : m))
    mentions.value = [...shifted, inserted].sort((a, b) => a.start - b.start)
    text.value = text.value.slice(0, current.start) + label + spacer + after
    caret.value = inserted.end + 1
    dismissedAt.value = null
    return caret.value
  }

  /** Inserts `@` at the caret (or at the end), with a space before it if needed, and returns the new caret. */
  function insertTrigger(): number {
    const at = caret.value ?? text.value.length
    const before = text.value.slice(0, at)
    const trigger = before === '' || /\s$/.test(before) ? '@' : ' @'
    const nextCaret = at + trigger.length
    update(before + trigger + text.value.slice(at), nextCaret)
    return nextCaret
  }

  /** Hides the suggestions of the current `@` (Escape) until another `@` is typed. */
  function dismiss(): void {
    if (pending.value) dismissedAt.value = pending.value.start
  }

  function reset(): void {
    text.value = ''
    caret.value = null
    mentions.value = []
    dismissedAt.value = null
  }

  return {
    text: readonly(text),
    caret: readonly(caret),
    mentions: computed<readonly InsertedMention[]>(() => mentions.value),
    query,
    suggestions,
    serialized,
    length,
    update,
    moveCaret,
    select,
    insertTrigger,
    dismiss,
    reset,
  }
}
