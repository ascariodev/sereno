import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useMentionInput } from './useMentionInput'
import { useMentionKeyboard } from './useMentionKeyboard'

const people = [
  { id: 1, name: 'Ana Perez', email: 'ana@example.com' },
  { id: 2, name: 'Andres Gil', email: 'andres@example.com' },
]

function setup() {
  const mention = useMentionInput({ members: () => people })
  const field = ref<HTMLTextAreaElement | null>(document.createElement('textarea'))
  const ensureLoaded = vi.fn()
  const keyboard = useMentionKeyboard({ mention, field, listId: 'list', ensureLoaded })
  return { mention, field, ensureLoaded, keyboard }
}

function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: name, cancelable: true, ...init })
}

describe('useMentionKeyboard', () => {
  it('ignores keys while closed', () => {
    const { keyboard } = setup()
    const event = key('Escape')
    expect(keyboard.open.value).toBe(false)
    expect(keyboard.handleKeydown(event)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
  })

  it('moves the active option with the arrows, wrapping around', async () => {
    const { mention, keyboard } = setup()
    mention.update('@an', 3)
    await nextTick()
    expect(keyboard.open.value).toBe(true)
    expect(keyboard.optionId(1)).toBe('list-1')
    expect(keyboard.handleKeydown(key('ArrowDown'))).toBe(true)
    expect(keyboard.activeIndex.value).toBe(1)
    keyboard.handleKeydown(key('ArrowDown'))
    expect(keyboard.activeIndex.value).toBe(0)
    keyboard.handleKeydown(key('ArrowUp'))
    expect(keyboard.activeIndex.value).toBe(1)
  })

  it('chooses the active suggestion with Enter or Tab, not with Shift+Enter', async () => {
    const { mention, keyboard } = setup()
    mention.update('@an', 3)
    await nextTick()
    const shifted = key('Enter', { shiftKey: true })
    expect(keyboard.handleKeydown(shifted)).toBe(false)
    expect(shifted.defaultPrevented).toBe(false)
    keyboard.handleKeydown(key('ArrowDown'))
    const enter = key('Enter')
    expect(keyboard.handleKeydown(enter)).toBe(true)
    expect(enter.defaultPrevented).toBe(true)
    expect(mention.text.value).toContain('Andres Gil')
    expect(keyboard.open.value).toBe(false)

    mention.reset()
    await nextTick()
    mention.update('@an', 3)
    await nextTick()
    expect(keyboard.handleKeydown(key('Tab'))).toBe(true)
    expect(mention.text.value).toContain('Ana Perez')
  })

  it('closes the suggestions with Escape and stops the event', async () => {
    const { mention, keyboard } = setup()
    mention.update('@an', 3)
    await nextTick()
    const event = key('Escape')
    const stop = vi.spyOn(event, 'stopPropagation')
    expect(keyboard.handleKeydown(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(stop).toHaveBeenCalled()
    expect(keyboard.open.value).toBe(false)
    expect(keyboard.handleKeydown(key('Escape'))).toBe(false)
  })

  it('loads the directory when a query appears and resets the active option when the list changes', async () => {
    const { mention, ensureLoaded, keyboard } = setup()
    mention.update('hola', 4)
    await nextTick()
    expect(ensureLoaded).not.toHaveBeenCalled()
    mention.update('hola @an', 8)
    await nextTick()
    expect(ensureLoaded).toHaveBeenCalledTimes(1)
    keyboard.handleKeydown(key('ArrowDown'))
    expect(keyboard.activeIndex.value).toBe(1)
    mention.update('hola @ana', 9)
    await nextTick()
    expect(keyboard.activeIndex.value).toBe(0)
  })
})
