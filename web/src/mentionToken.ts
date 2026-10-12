import type { InsertedMention, MentionDraft } from './composables/useMentionInput'

// Same token as the API (StoreMessageRequest): ids without leading zeros, up to 18 digits.
// Global flag: use it with matchAll/replace, never with test/exec (they keep lastIndex).
export const MENTION_TOKEN = /<@([1-9][0-9]{0,17})>/g

export function mentionToken(id: number): string {
  return `<@${id}>`
}

export type MentionPart = { text: string } | { mention: string; own: boolean }

export function splitMentions(
  text: string,
  mentions: readonly { id: number; name: string }[],
  unknownLabel: string,
  ownUserId?: number,
): MentionPart[] {
  const names = new Map(mentions.map((m) => [String(m.id), m.name]))
  const parts: MentionPart[] = []
  let last = 0
  for (const match of text.matchAll(MENTION_TOKEN)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) })
    parts.push({
      mention: names.get(match[1]) ?? unknownLabel,
      own: ownUserId !== undefined && String(ownUserId) === match[1],
    })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/**
 * Body with `<@id>` tokens to the draft of the editor: each token whose id is in `mentions` becomes `@Name` with
 * its range. A token with an unknown id (no name) stays as literal text, so saving without touching it keeps it.
 */
export function parseMentionDraft(body: string, mentions: readonly { id: number; name: string }[]): MentionDraft {
  const names = new Map(mentions.map((m) => [m.id, m.name]))
  const inserted: InsertedMention[] = []
  let text = ''
  let last = 0
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const id = Number(match[1])
    const name = names.get(id)
    if (name === undefined || !Number.isSafeInteger(id)) continue
    text += body.slice(last, match.index)
    const start = text.length
    text += `@${name}`
    inserted.push({ id, name, start, end: text.length })
    last = match.index + match[0].length
  }
  return { text: text + body.slice(last), mentions: inserted }
}
