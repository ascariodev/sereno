import { describe, expect, it } from 'vitest'
import { useMentionInput } from './composables/useMentionInput'
import { parseMentionDraft } from './mentionToken'

const known = [
  { id: 1, name: 'Ana Pérez' },
  { id: 5, name: 'Camila' },
]

function roundTrip(body: string, mentions = known): string {
  const input = useMentionInput({ members: () => [] })
  input.restore(parseMentionDraft(body, mentions))
  return input.serialized.value
}

describe('parseMentionDraft', () => {
  it('turns tokens into @Name with UTF-16 ranges, with emojis', () => {
    const draft = parseMentionDraft('😀 hola <@1> y 👨‍👩‍👧 <@5>!', known)
    expect(draft.text).toBe('😀 hola @Ana Pérez y 👨‍👩‍👧 @Camila!')
    for (const m of draft.mentions) expect(draft.text.slice(m.start, m.end)).toBe(`@${m.name}`)
    expect(draft.mentions.map((m) => m.id)).toEqual([1, 5])
  })

  it('round-trips through serialized', () => {
    for (const body of ['<@1>', 'a <@1> b <@5>', '😀<@5>😀', 'sin menciones', '', '<@1><@1> <@1>']) {
      expect(roundTrip(body)).toBe(body)
    }
  })

  it('handles repeated mentions as separate ranges', () => {
    const draft = parseMentionDraft('<@1> y <@1>', known)
    expect(draft.text).toBe('@Ana Pérez y @Ana Pérez')
    expect(draft.mentions.map((m) => [m.start, m.end])).toEqual([[0, 10], [13, 23]])
  })

  it('keeps unknown ids as literal text and round-trips them', () => {
    const draft = parseMentionDraft('hi <@99> and <@1>', known)
    expect(draft.text).toBe('hi <@99> and @Ana Pérez')
    expect(draft.mentions.map((m) => m.id)).toEqual([1])
    expect(roundTrip('hi <@99> and <@1>')).toBe('hi <@99> and <@1>')
  })

  it('leaves malformed tokens as text', () => {
    for (const body of ['<@>', '<@0>', '<@01>', '<@1', '@1>', '<@ 1>', '<@abc>', '<@1234567890123456789>']) {
      expect(parseMentionDraft(body, known)).toEqual({ text: body, mentions: [] })
      expect(roundTrip(body)).toBe(body)
    }
  })
})
