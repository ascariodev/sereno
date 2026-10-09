import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { MentionCandidate } from './useMentionInput'

interface MentionLike<T extends MentionCandidate> {
  suggestions: Ref<T[]>
  query: Ref<unknown>
  select(member: T): number | null
  dismiss(): void
  moveCaret(start: number | null, end?: number | null): void
}

export interface MentionKeyboardOptions<T extends MentionCandidate> {
  mention: MentionLike<T>
  field: Ref<HTMLTextAreaElement | null>
  listId: string
  /** Called when a query appears, to load the member directory. */
  ensureLoaded: () => unknown
}

/** Suggestion list state and keyboard handling shared by the message composer and editor. */
export function useMentionKeyboard<T extends MentionCandidate>(options: MentionKeyboardOptions<T>) {
  const { mention, field, listId } = options
  const activeIndex = ref(0)
  const open = computed(() => mention.suggestions.value.length > 0)

  function optionId(index: number): string {
    return `${listId}-${index}`
  }

  watch(
    () => mention.query.value,
    (query) => {
      if (query) void options.ensureLoaded()
    },
  )
  watch(
    () => mention.suggestions.value.map((m) => m.id).join(','),
    () => {
      activeIndex.value = 0
    },
  )

  async function setCaret(position: number | null): Promise<void> {
    if (position === null) return
    await nextTick()
    field.value?.focus()
    field.value?.setSelectionRange(position, position)
  }

  function syncCaret(): void {
    const el = field.value
    if (el) mention.moveCaret(el.selectionStart, el.selectionEnd)
  }

  function choose(index: number): void {
    const member = mention.suggestions.value[index]
    if (!member) return
    void setCaret(mention.select(member))
  }

  /** Handles keys while the suggestions are open; returns true when the event was consumed. */
  function handleKeydown(event: KeyboardEvent): boolean {
    if (!open.value) return false
    const count = mention.suggestions.value.length
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      activeIndex.value = (activeIndex.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
      return true
    }
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      event.preventDefault()
      choose(activeIndex.value)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      mention.dismiss()
      return true
    }
    return false
  }

  return { activeIndex, open, optionId, setCaret, syncCaret, choose, handleKeydown }
}
