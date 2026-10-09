import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { MENTION_TOKEN, mentionToken } from '../mentionToken'
import { normalizeForSearch, useMentionInput } from './useMentionInput'

interface Person {
  id: number
  name: string
  email: string
}

const people: Person[] = [
  { id: 1, name: 'Ana Pérez', email: 'ana.perez@example.com' },
  { id: 2, name: 'Ana Pérez', email: 'ana.p@example.com' },
  { id: 3, name: 'José López', email: 'jose@example.com' },
  { id: 4, name: 'María Ana Ruiz', email: 'maria@example.com' },
  { id: 5, name: 'Camila', email: 'camila@example.com' },
]

function setup(options: { exclude?: number; limit?: number } = {}) {
  return useMentionInput({ members: () => people, excludeUserId: () => options.exclude, limit: options.limit })
}

/** Types `value` at the caret, as an input event would report it. */
function type(input: ReturnType<typeof setup>, value: string): void {
  const at = input.caret.value ?? input.text.value.length
  const next = input.text.value.slice(0, at) + value + input.text.value.slice(at)
  input.update(next, at + value.length)
}

function mentionOf(input: ReturnType<typeof setup>, id: number): void {
  type(input, '@')
  const member = people.find((p) => p.id === id)!
  expect(input.select(member)).not.toBeNull()
}

describe('mention token', () => {
  it('builds the token the shared regex reads back', () => {
    const ids = [...`a ${mentionToken(42)} b ${mentionToken(7)}`.matchAll(MENTION_TOKEN)].map((m) => m[1])
    expect(ids).toEqual(['42', '7'])
  })
})

describe('useMentionInput: detecting @', () => {
  it('opens at the start of the text, after a space and after a line break', () => {
    const input = setup()
    input.update('@an', 3)
    expect(input.query.value).toEqual({ start: 0, text: 'an' })
    input.update('hi @an', 6)
    expect(input.query.value).toEqual({ start: 3, text: 'an' })
    input.update('hi\n@an', 6)
    expect(input.query.value).toEqual({ start: 3, text: 'an' })
    expect(input.suggestions.value.map((p) => p.id)).toEqual([1, 2, 4])
  })

  it('opens with an empty query right after @, listing members up to the limit', () => {
    const input = setup({ limit: 3 })
    input.update('@', 1)
    expect(input.query.value).toEqual({ start: 0, text: '' })
    expect(input.suggestions.value.map((p) => p.id)).toEqual([1, 2, 3])
  })

  it('does not open in the middle of a word or in an email', () => {
    const input = setup()
    input.update('foo@an', 6)
    expect(input.query.value).toBeNull()
    input.update('write to ana@example.com', 24)
    expect(input.query.value).toBeNull()
    expect(input.suggestions.value).toEqual([])
  })

  it('opens after opening punctuation but not after a word or closing punctuation', () => {
    const input = setup()
    for (const opener of ['(', '[', '{', '"', "'", '¿', '¡']) {
      input.update(`hi ${opener}@an`, 7)
      expect(input.query.value, opener).toEqual({ start: 4, text: 'an' })
    }
    input.update('("@an', 5)
    expect(input.query.value).toEqual({ start: 2, text: 'an' })
    for (const closer of [')', '.', 'a', '1']) {
      input.update(`x${closer}@an`, 5)
      expect(input.query.value, closer).toBeNull()
    }
  })

  it('does not open without a caret, after a line break in the query or with a leading space', () => {
    const input = setup()
    input.update('@an', null)
    expect(input.query.value).toBeNull()
    input.update('@an\nx', 5)
    expect(input.query.value).toBeNull()
    input.update('@ an', 4)
    expect(input.query.value).toBeNull()
  })

  it('follows the caret: only the @ right before it counts', () => {
    const input = setup()
    input.update('@an hello', 9)
    expect(input.suggestions.value).toEqual([])
    input.moveCaret(3)
    expect(input.query.value).toEqual({ start: 0, text: 'an' })
    input.moveCaret(1, 3)
    expect(input.query.value).toBeNull()
  })

  it('accepts spaces in the query to reach names with spaces', () => {
    const input = setup()
    input.update('@ana pe', 7)
    expect(input.suggestions.value.map((p) => p.id)).toEqual([1, 2])
  })
})

describe('useMentionInput: filtering', () => {
  it('ignores case and accents in both directions', () => {
    expect(normalizeForSearch('  JOSÉ   López ')).toBe('jose lopez')
    const input = setup()
    input.update('@JOSE', 5)
    expect(input.suggestions.value.map((p) => p.id)).toEqual([3])
    input.update('@pérez', 6)
    expect(input.suggestions.value.map((p) => p.id)).toEqual([1, 2])
    input.update('@lóp', 4)
    expect(input.suggestions.value.map((p) => p.id)).toEqual([3])
  })

  it('puts names that start with the query before names with a later word that does', () => {
    const input = setup()
    input.update('@ana', 4)
    expect(input.suggestions.value.map((p) => p.id)).toEqual([1, 2, 4])
    input.update('@na', 3)
    expect(input.suggestions.value).toEqual([])
  })

  it('leaves out the excluded user and reacts to member changes', () => {
    const members = ref<Person[]>([people[4]])
    const input = useMentionInput({ members, excludeUserId: 5 })
    input.update('@', 1)
    expect(input.suggestions.value).toEqual([])
    members.value = [people[4], people[2]]
    expect(input.suggestions.value.map((p) => p.id)).toEqual([3])
  })
})

describe('useMentionInput: inserting and serializing', () => {
  it('replaces the query with @Name and a space, closes the list and returns the caret', () => {
    const input = setup()
    input.update('hi @jo', 6)
    const caret = input.select(people[2])
    expect(input.text.value).toBe('hi @José López ')
    expect(caret).toBe(15)
    expect(input.caret.value).toBe(15)
    expect(input.query.value).toBeNull()
    expect(input.serialized.value).toBe('hi <@3> ')
  })

  it('does not add a second space when one follows the caret', () => {
    const input = setup()
    input.update('@ca hi', 3)
    expect(input.select(people[4])).toBe(8)
    expect(input.text.value).toBe('@Camila hi')
    expect(input.serialized.value).toBe('<@5> hi')
  })

  it('inserts a space and keeps the caret on the same line before a line break', () => {
    const input = setup()
    input.update('@ca\nhola', 3)
    expect(input.select(people[4])).toBe(8)
    expect(input.text.value).toBe('@Camila \nhola')
  })

  it('keeps the id of each pick, so two people with the same name serialize apart', () => {
    const input = setup()
    mentionOf(input, 2)
    type(input, 'and ')
    mentionOf(input, 1)
    expect(input.text.value).toBe('@Ana Pérez and @Ana Pérez ')
    expect(input.serialized.value).toBe('<@2> and <@1> ')
    expect(input.mentions.value.map((m) => m.id)).toEqual([2, 1])
  })

  it('shifts later mentions when inserting before them', () => {
    const input = setup()
    mentionOf(input, 5)
    input.moveCaret(0)
    type(input, '@jo')
    input.select(people[2])
    expect(input.text.value).toBe('@José López @Camila ')
    expect(input.serialized.value).toBe('<@3> <@5> ')
  })

  it('returns null when there is no query', () => {
    const input = setup()
    input.update('hello', 5)
    expect(input.select(people[0])).toBeNull()
    expect(input.text.value).toBe('hello')
  })

  it('does not reopen the list on an inserted mention', () => {
    const input = setup()
    mentionOf(input, 5)
    input.moveCaret(7)
    expect(input.query.value).toBeNull()
    input.moveCaret(3)
    expect(input.query.value).toBeNull()
  })

  it('sends typed text that looks like a mention as plain text', () => {
    const input = setup()
    input.update('@Camila hi', 10)
    expect(input.mentions.value).toEqual([])
    expect(input.serialized.value).toBe('@Camila hi')
  })
})

describe('useMentionInput: editing an inserted mention', () => {
  it('keeps the mention when typing right after or right before it', () => {
    const input = setup()
    mentionOf(input, 5)
    type(input, 'hi')
    input.moveCaret(0)
    type(input, 'x ')
    expect(input.text.value).toBe('x @Camila hi')
    expect(input.serialized.value).toBe('x <@5> hi')
  })

  it('drops the mention when typing inside it, even with a repeated letter', () => {
    const input = setup()
    mentionOf(input, 5)
    input.moveCaret(6)
    type(input, 'a')
    expect(input.text.value).toBe('@Camilaa ')
    expect(input.mentions.value).toEqual([])
    expect(input.serialized.value).toBe('@Camilaa ')
  })

  it('drops the mention when deleting part of it, and keeps the others', () => {
    const input = setup()
    mentionOf(input, 5)
    mentionOf(input, 3)
    input.update('@Camil @José López ', 6)
    expect(input.serialized.value).toBe('@Camil <@3> ')
    expect(input.mentions.value).toEqual([{ id: 3, name: 'José López', start: 7, end: 18 }])
  })

  it('drops the mention when it is deleted whole, shifting the rest', () => {
    const input = setup()
    mentionOf(input, 5)
    mentionOf(input, 3)
    input.update('@José López ', 0)
    expect(input.serialized.value).toBe('<@3> ')
  })

  it('handles a paste that replaces a selection across a mention, and one before it', () => {
    const input = setup()
    type(input, 'a ')
    mentionOf(input, 5)
    type(input, 'b')
    expect(input.text.value).toBe('a @Camila b')
    input.update('a @CaPASTED', 11)
    expect(input.mentions.value).toEqual([])
    expect(input.serialized.value).toBe('a @CaPASTED')

    const other = setup()
    other.update('x ', 2)
    mentionOf(other, 5)
    other.moveCaret(0)
    other.update('pasted\ntext x @Camila ', 12)
    expect(other.serialized.value).toBe('pasted\ntext x <@5> ')
  })

  it('keeps the old mention when a longer @Anabel is pasted over a selection that is exactly @Ana', () => {
    const input = useMentionInput({ members: () => [{ id: 9, name: 'Ana' }] })
    input.update('@', 1)
    input.select({ id: 9, name: 'Ana' })
    input.update('@Ana', 4)
    input.moveCaret(0, 4)
    input.update('@Anabel', 7)
    // Known limitation: the edit is read as typing "bel" right after the mention, so it stays a mention.
    expect(input.mentions.value).toEqual([{ id: 9, name: 'Ana', start: 0, end: 4 }])
    expect(input.serialized.value).toBe(`${mentionToken(9)}bel`)
  })

  it('works without a caret, as when the value is set by code', () => {
    const input = setup()
    mentionOf(input, 5)
    input.update('@Camila hello', null)
    expect(input.serialized.value).toBe('<@5> hello')
  })
})

describe('useMentionInput: names with emoji', () => {
  it('inserts and serializes a mention whose name has emoji, with UTF-16 indices', () => {
    const member = { id: 7, name: 'Sol 🌞 Díaz' }
    const input = useMentionInput({ members: () => [member] })
    input.update('hi (@so', 7)
    expect(input.suggestions.value).toEqual([member])
    const caret = input.select(member)
    expect(input.text.value).toBe('hi (@Sol 🌞 Díaz ')
    expect(input.mentions.value).toEqual([{ id: 7, name: member.name, start: 4, end: 4 + `@${member.name}`.length }])
    expect(caret).toBe(input.text.value.length)
    input.update(`${input.text.value}ok`, caret! + 2)
    expect(input.serialized.value).toBe(`hi (${mentionToken(7)} ok`)
    expect(input.length.value).toBe([...`hi (${mentionToken(7)} ok`].length)
  })
})

describe('useMentionInput: length', () => {
  it('counts characters of the serialized body, emojis as one', () => {
    const input = setup()
    type(input, '😀😀 ')
    mentionOf(input, 3)
    expect(input.serialized.value).toBe('😀😀 <@3> ')
    expect(input.length.value).toBe(8)
  })

  it('can exceed the 4000 limit only once serialized', () => {
    const input = useMentionInput({ members: [{ id: 123456, name: 'Al' }] })
    input.update('😀'.repeat(3994) + ' @', 7990)
    input.select({ id: 123456, name: 'Al' })
    expect([...input.text.value].length).toBe(3999)
    expect(input.length.value).toBe(4005)
    expect(input.length.value).toBeGreaterThan(4000)
  })
})

describe('useMentionInput: helpers', () => {
  it('inserts the trigger at the caret with a space when needed', () => {
    const input = setup()
    expect(input.insertTrigger()).toBe(1)
    expect(input.query.value).toEqual({ start: 0, text: '' })
    input.update('hi', 2)
    expect(input.insertTrigger()).toBe(4)
    expect(input.text.value).toBe('hi @')
    expect(input.suggestions.value).toHaveLength(5)
  })

  it('dismisses the list until another @ is typed', () => {
    const input = setup()
    input.update('@a', 2)
    input.dismiss()
    expect(input.query.value).toBeNull()
    type(input, 'n')
    expect(input.query.value).toBeNull()
    type(input, ' @')
    expect(input.query.value).toEqual({ start: 4, text: '' })
  })

  it('resets text, caret, mentions and dismissal after sending', () => {
    const input = setup()
    mentionOf(input, 5)
    type(input, '@x')
    input.dismiss()
    input.reset()
    expect(input.text.value).toBe('')
    expect(input.caret.value).toBeNull()
    expect(input.mentions.value).toEqual([])
    expect(input.serialized.value).toBe('')
    expect(input.length.value).toBe(0)
    input.update('@', 1)
    expect(input.query.value).toEqual({ start: 0, text: '' })
  })
})
