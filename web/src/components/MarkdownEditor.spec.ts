import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { i18n } from '../i18n'
import MarkdownEditor from './MarkdownEditor.vue'

enableAutoUnmount(afterEach)

function mountEditor(modelValue = '', props: Record<string, unknown> = {}) {
  const wrapper = mount(MarkdownEditor, {
    attachTo: document.body,
    props: {
      modelValue,
      'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }),
      ...props,
    },
    global: { plugins: [i18n] },
  })
  return wrapper
}

function select(wrapper: ReturnType<typeof mountEditor>, start: number, end: number) {
  const el = wrapper.find('textarea').element as HTMLTextAreaElement
  el.setSelectionRange(start, end)
  return el
}

describe('MarkdownEditor', () => {
  it('exposes a labelled toolbar of named buttons', () => {
    const wrapper = mountEditor()

    expect(wrapper.find('[role=toolbar]').attributes('aria-label')).toBe('Formatting')
    const names = wrapper.findAll('[role=toolbar] button').map((b) => b.attributes('aria-label'))
    expect(names).toEqual(['Bold', 'Italic', 'Heading', 'Bulleted list', 'Numbered list', 'Quote', 'Code', 'Link'])
    expect(wrapper.find('[data-test=tool-bold]').attributes('aria-keyshortcuts')).toBe('Control+B')
  })

  it('formats the selection from a toolbar button and keeps it selected', async () => {
    const wrapper = mountEditor('say hello')
    const el = select(wrapper, 4, 9)

    await wrapper.find('[data-test=tool-bold]').trigger('click')
    await nextTick()

    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['say **hello**'])
    expect(el.value).toBe('say **hello**')
    expect([el.selectionStart, el.selectionEnd]).toEqual([6, 11])
  })

  it('prefixes lines from the list buttons', async () => {
    const wrapper = mountEditor('a\nb')
    select(wrapper, 0, 3)

    await wrapper.find('[data-test=tool-numberedList]').trigger('click')

    expect(wrapper.props('modelValue')).toBe('1. a\n2. b')
  })

  it('applies Ctrl+B, Ctrl+I and Ctrl+K and prevents the browser default', async () => {
    const wrapper = mountEditor('word')
    select(wrapper, 0, 4)
    const textarea = wrapper.find('textarea')

    const bold = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true, bubbles: true })
    textarea.element.dispatchEvent(bold)
    await nextTick()
    expect(bold.defaultPrevented).toBe(true)
    expect(wrapper.props('modelValue')).toBe('**word**')

    await wrapper.setProps({ modelValue: 'word' })
    select(wrapper, 0, 4)
    await textarea.trigger('keydown', { key: 'i', ctrlKey: true })
    expect(wrapper.props('modelValue')).toBe('_word_')

    await wrapper.setProps({ modelValue: 'word' })
    select(wrapper, 0, 4)
    await textarea.trigger('keydown', { key: 'k', metaKey: true })
    expect(wrapper.props('modelValue')).toBe('[word](https://)')
  })

  it('ignores plain keys and other Ctrl combinations', async () => {
    const wrapper = mountEditor('word')
    select(wrapper, 0, 4)

    await wrapper.find('textarea').trigger('keydown', { key: 'b' })
    await wrapper.find('textarea').trigger('keydown', { key: 'x', ctrlKey: true })
    await wrapper.find('textarea').trigger('keydown', { key: 'b', ctrlKey: true, shiftKey: true })

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('emits typed text', async () => {
    const wrapper = mountEditor()
    await wrapper.find('textarea').setValue('hello')

    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['hello'])
  })

  it('switches between Write and Preview and renders the Markdown safely', async () => {
    const wrapper = mountEditor('**bold** <script>alert(1)</script>')
    const [write, preview] = wrapper.findAll('.app-segmented button')

    expect(write.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-test=preview]').exists()).toBe(false)

    await preview.trigger('click')
    expect(preview.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-test=preview] strong').text()).toBe('bold')
    expect(wrapper.find('[data-test=preview] script').exists()).toBe(false)
    expect(wrapper.find('[role=toolbar]').isVisible()).toBe(false)

    await write.trigger('click')
    expect(wrapper.find('[data-test=preview]').exists()).toBe(false)
    expect(wrapper.find('[role=toolbar]').isVisible()).toBe(true)
  })

  it('says there is nothing to preview for empty text', async () => {
    const wrapper = mountEditor('  ')
    await wrapper.findAll('.app-segmented button')[1].trigger('click')

    expect(wrapper.find('[data-test=preview]').text()).toBe('Nothing to preview.')
  })

  it('counts characters, not UTF-16 units, and flags the excess', async () => {
    const wrapper = mountEditor('😀😀😀', { maxLength: 3 })

    expect(wrapper.find('[data-test=count]').text()).toBe('3 / 3')
    expect(wrapper.find('[data-test=count]').classes()).not.toContain('markdown-editor__count--over')

    await wrapper.setProps({ modelValue: '😀😀😀😀' })
    expect(wrapper.find('[data-test=count]').text()).toBe('4 / 3')
    expect(wrapper.find('[data-test=count]').classes()).toContain('markdown-editor__count--over')
  })

  it('does not truncate text by UTF-16 length', () => {
    const wrapper = mountEditor('😀')

    expect(wrapper.find('textarea').attributes('maxlength')).toBeUndefined()
  })

  it('is read-only: no editing, disabled toolbar, no shortcuts', async () => {
    const wrapper = mountEditor('word', { readonly: true })
    select(wrapper, 0, 4)

    expect(wrapper.find('textarea').attributes('readonly')).toBeDefined()
    expect(wrapper.findAll('[role=toolbar] button').every((b) => b.attributes('disabled') !== undefined)).toBe(true)

    const bold = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true, bubbles: true })
    wrapper.find('textarea').element.dispatchEvent(bold)
    await nextTick()
    expect(bold.defaultPrevented).toBe(true)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('passes id, name and aria attributes to the textarea', () => {
    const wrapper = mountEditor('', { id: 'desc', name: 'description', ariaInvalid: 'true', ariaDescribedby: 'err' })
    const textarea = wrapper.find('textarea')

    expect(textarea.attributes('id')).toBe('desc')
    expect(textarea.attributes('name')).toBe('description')
    expect(textarea.attributes('aria-invalid')).toBe('true')
    expect(textarea.attributes('aria-describedby')).toBe('err')
  })

  describe('undo history', () => {
    afterEach(() => {
      Reflect.deleteProperty(document, 'execCommand')
    })

    function mockExecCommand(handler: (command: string, text?: string) => boolean) {
      const spy = vi.fn((command: string, _ui?: boolean, text?: string) => handler(command, text))
      Object.defineProperty(document, 'execCommand', { value: spy, configurable: true, writable: true })
      return spy
    }

    function typeInto(command: string, text = '') {
      const el = document.activeElement as HTMLTextAreaElement
      const { selectionStart, selectionEnd, value } = el
      el.value = value.slice(0, selectionStart) + (command === 'delete' ? '' : text) + value.slice(selectionEnd)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }

    it('inserts the changed range through execCommand, emits once and keeps the selection', async () => {
      const wrapper = mountEditor('say hello')
      const el = select(wrapper, 4, 9)
      const spy = mockExecCommand(typeInto)

      await wrapper.find('[data-test=tool-bold]').trigger('click')
      await nextTick()

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0]).toEqual(['insertText', false, '**hello**'])
      expect(wrapper.emitted('update:modelValue')).toEqual([['say **hello**']])
      expect([el.selectionStart, el.selectionEnd]).toEqual([6, 11])
    })

    it('uses a single insertion for multi-line formatting', async () => {
      const wrapper = mountEditor('a\nb')
      const el = select(wrapper, 0, 3)
      const spy = mockExecCommand(typeInto)

      await wrapper.find('[data-test=tool-bulletList]').trigger('click')
      await nextTick()

      expect(spy).toHaveBeenCalledTimes(1)
      expect(wrapper.emitted('update:modelValue')).toEqual([['- a\n- b']])
      expect(el.value).toBe('- a\n- b')
    })

    it('falls back to assigning the value when execCommand returns false', async () => {
      const wrapper = mountEditor('say hello')
      const el = select(wrapper, 4, 9)
      const spy = mockExecCommand(() => false)

      await wrapper.find('[data-test=tool-bold]').trigger('click')
      await nextTick()

      expect(spy).toHaveBeenCalledTimes(1)
      expect(wrapper.emitted('update:modelValue')).toEqual([['say **hello**']])
      expect(el.value).toBe('say **hello**')
      expect([el.selectionStart, el.selectionEnd]).toEqual([6, 11])
    })

    it('falls back with a single emission when execCommand returns true without changing the value', async () => {
      const wrapper = mountEditor('say hello')
      const el = select(wrapper, 4, 9)
      const spy = mockExecCommand(() => true)

      await wrapper.find('[data-test=tool-bold]').trigger('click')
      await nextTick()

      expect(spy).toHaveBeenCalledTimes(1)
      expect(wrapper.emitted('update:modelValue')).toEqual([['say **hello**']])
      expect(el.value).toBe('say **hello**')
      expect([el.selectionStart, el.selectionEnd]).toEqual([6, 11])
    })

    it('computes the changed range after an emoji', async () => {
      const wrapper = mountEditor('😀 hola')
      const el = select(wrapper, 3, 7)
      const spy = mockExecCommand(typeInto)

      await wrapper.find('[data-test=tool-bold]').trigger('click')
      await nextTick()

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0]).toEqual(['insertText', false, '**hola**'])
      expect(wrapper.emitted('update:modelValue')).toEqual([['😀 **hola**']])
      expect([el.selectionStart, el.selectionEnd]).toEqual([5, 9])
    })

    it('keeps the changed range on code point boundaries for emojis sharing the high surrogate', async () => {
      const wrapper = mountEditor('\u{1F600}\u{1F601}')
      const el = select(wrapper, 1, 3)
      const ranges: number[][] = []
      const spy = mockExecCommand((command, text) => {
        ranges.push([el.selectionStart, el.selectionEnd])
        return typeInto(command, text)
      })

      await wrapper.find('[data-test=tool-bold]').trigger('click')
      await nextTick()

      expect(ranges).toEqual([[0, 4]])
      expect(spy.mock.calls[0]).toEqual(['insertText', false, '\ud83d**\ude00\ud83d**\ude01'])
      expect(el.value).toBe('\ud83d**\ude00\ud83d**\ude01')
    })

    it('falls back when execCommand does not exist', async () => {
      const wrapper = mountEditor('word')
      select(wrapper, 0, 4)
      expect(typeof document.execCommand).not.toBe('function')

      await wrapper.find('[data-test=tool-bold]').trigger('click')

      expect(wrapper.emitted('update:modelValue')).toEqual([['**word**']])
    })
  })

  describe('mentions', () => {
    const members = [
      { id: 1, name: 'Me Myself', email: 'me@example.com' },
      { id: 2, name: 'Ana Pérez', email: 'ana@example.com' },
      { id: 3, name: 'Bruno Díaz', email: 'bruno@example.com' },
      { id: 4, name: 'Andrés Gil', email: 'andres@example.com' },
    ]

    function mountWithMentions(modelValue = '', extra: Record<string, unknown> = {}) {
      return mountEditor(modelValue, { mentions: { members, excludeUserId: 1, ...extra } })
    }

    async function type(wrapper: ReturnType<typeof mountEditor>, value: string) {
      await wrapper.find('textarea').setValue(value)
    }

    function optionNames(wrapper: ReturnType<typeof mountEditor>) {
      return wrapper.findAll('[role=option]').map((o) => o.find('span').text())
    }

    it('has no suggestion list nor combobox role without the prop', async () => {
      const wrapper = mountEditor()

      await type(wrapper, 'hi @an')

      const textarea = wrapper.find('textarea')
      expect(textarea.attributes('role')).toBeUndefined()
      expect(textarea.attributes('aria-expanded')).toBeUndefined()
      expect(wrapper.find('[role=listbox]').exists()).toBe(false)
      expect(wrapper.find('[role=status]').exists()).toBe(false)
      expect(wrapper.emitted('update:modelValue')).toEqual([['hi @an']])
    })

    it('opens an accessible list on @ like the chat composer and loads the members', async () => {
      const ensureLoaded = vi.fn()
      const wrapper = mountWithMentions('', { ensureLoaded })
      const textarea = wrapper.find('textarea')
      expect(textarea.attributes('role')).toBe('combobox')
      expect(textarea.attributes('aria-expanded')).toBe('false')
      expect(textarea.attributes('aria-activedescendant')).toBeUndefined()

      await type(wrapper, 'hi @')

      const list = wrapper.find('[role=listbox]')
      expect(list.isVisible()).toBe(true)
      expect(list.attributes('aria-label')).toBe('Mention suggestions')
      expect(textarea.attributes('aria-expanded')).toBe('true')
      expect(textarea.attributes('aria-autocomplete')).toBe('list')
      expect(textarea.attributes('aria-haspopup')).toBe('listbox')
      expect(textarea.attributes('aria-controls')).toBe(list.attributes('id'))
      expect(optionNames(wrapper)).toEqual(['Ana Pérez', 'Bruno Díaz', 'Andrés Gil'])
      const options = wrapper.findAll('[role=option]')
      expect(textarea.attributes('aria-activedescendant')).toBe(options[0].attributes('id'))
      expect(options.map((o) => o.attributes('aria-selected'))).toEqual(['true', 'false', 'false'])
      expect(wrapper.find('[role=status]').text()).toContain('3 suggestions available')
      expect(ensureLoaded).toHaveBeenCalled()
    })

    it('filters the list by the typed name, ignoring accents', async () => {
      const wrapper = mountWithMentions()

      await type(wrapper, '@andre')

      expect(optionNames(wrapper)).toEqual(['Andrés Gil'])
    })

    it('chooses with the arrows and Enter, emitting the token and showing the name', async () => {
      const wrapper = mountWithMentions()
      await type(wrapper, 'hi @')
      const textarea = wrapper.find('textarea')

      await textarea.trigger('keydown', { key: 'ArrowDown' })
      expect(textarea.attributes('aria-activedescendant')).toBe(wrapper.findAll('[role=option]')[1].attributes('id'))
      await textarea.trigger('keydown', { key: 'ArrowUp' })
      await textarea.trigger('keydown', { key: 'ArrowUp' })
      const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
      textarea.element.dispatchEvent(enter)
      await nextTick()

      expect(enter.defaultPrevented).toBe(true)
      expect((textarea.element as HTMLTextAreaElement).value).toBe('hi @Andrés Gil ')
      expect(wrapper.props('modelValue')).toBe('hi <@4> ')
      expect(wrapper.find('[role=listbox]').isVisible()).toBe(false)
      expect(textarea.attributes('aria-expanded')).toBe('false')
    })

    it('chooses with Tab', async () => {
      const wrapper = mountWithMentions()
      await type(wrapper, '@br')

      await wrapper.find('textarea').trigger('keydown', { key: 'Tab' })

      expect(wrapper.props('modelValue')).toBe('<@3> ')
    })

    it('chooses with a click', async () => {
      const wrapper = mountWithMentions()
      await type(wrapper, 'cc @')

      await wrapper.findAll('[role=option]')[1].trigger('click')

      expect(wrapper.props('modelValue')).toBe('cc <@3> ')
      expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('cc @Bruno Díaz ')
    })

    it('closes on Escape without letting it reach a dialog', async () => {
      const wrapper = mountWithMentions()
      const outside = vi.fn()
      wrapper.element.addEventListener('keydown', outside)
      await type(wrapper, '@a')
      expect(wrapper.find('[role=listbox]').isVisible()).toBe(true)

      await wrapper.find('textarea').trigger('keydown', { key: 'Escape' })

      expect(wrapper.find('[role=listbox]').isVisible()).toBe(false)
      expect(wrapper.find('textarea').attributes('aria-expanded')).toBe('false')
      expect(outside).not.toHaveBeenCalled()
      expect(wrapper.props('modelValue')).toBe('@a')
    })

    it('leaves Enter, arrows, Tab and Escape alone while the list is closed', async () => {
      const wrapper = mountWithMentions()
      const outside = vi.fn()
      wrapper.element.addEventListener('keydown', outside)
      await type(wrapper, 'plain')
      const textarea = wrapper.find('textarea').element

      for (const key of ['Enter', 'ArrowDown', 'Tab', 'Escape']) {
        const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true })
        textarea.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
      }
      expect(outside).toHaveBeenCalledTimes(4)
    })

    it('keeps the formatting shortcuts and the mention when wrapping it', async () => {
      const wrapper = mountWithMentions()
      await type(wrapper, '@an')
      await wrapper.find('textarea').trigger('keydown', { key: 'Enter' })
      await nextTick()
      select(wrapper, 0, 10)

      await wrapper.find('textarea').trigger('keydown', { key: 'b', ctrlKey: true })

      expect(wrapper.props('modelValue')).toBe('**<@2>** ')
    })

    it('keeps the mentions moved by a line format and drops one the edit splits', async () => {
      const wrapper = mountWithMentions('hi <@2> and <@3>')
      select(wrapper, 0, 0)

      await wrapper.find('[data-test=tool-bulletList]').trigger('click')
      expect(wrapper.props('modelValue')).toBe('- hi <@2> and <@3>')

      select(wrapper, 7, 9)
      await wrapper.find('[data-test=tool-italic]').trigger('click')

      expect(wrapper.props('modelValue')).toBe('- hi @A_na_ Pérez and <@3>')
    })

    it('shows known tokens of the model value as names and follows a reset from the parent', async () => {
      const wrapper = mountWithMentions('see <@2> and <@99>')
      const textarea = wrapper.find('textarea').element as HTMLTextAreaElement
      expect(textarea.value).toBe('see @Ana Pérez and <@99>')

      await wrapper.setProps({ modelValue: '' })

      expect(textarea.value).toBe('')
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    })

    it('renders the chosen mention as a chip in the preview', async () => {
      const wrapper = mountWithMentions()
      await type(wrapper, '@bru')
      await wrapper.find('textarea').trigger('keydown', { key: 'Enter' })

      await wrapper.findAll('.app-segmented button')[1].trigger('click')

      expect(wrapper.find('[data-test=preview] .mention-chip').text()).toBe('@Bruno Díaz')
      expect(wrapper.find('[role=listbox]').isVisible()).toBe(false)
    })
  })
})
