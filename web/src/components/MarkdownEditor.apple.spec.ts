import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import MarkdownEditor from './MarkdownEditor.vue'

vi.mock('../platform', () => ({ isApple: true }))

describe('MarkdownEditor on Apple platforms', () => {
  it('shows the Command key in tooltips and aria-keyshortcuts', () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '' },
      global: {
        plugins: [i18n],
        stubs: { AppTooltip: { props: ['text'], template: '<div class="tip" :data-text="text"><slot /></div>' } },
      },
    })

    const tips = wrapper.findAll('.tip').map((t) => t.attributes('data-text'))
    expect(tips[0]).toBe('Bold (⌘B)')
    expect(tips[7]).toBe('Link (⌘K)')
    expect(wrapper.find('[data-test=tool-bold]').attributes('aria-keyshortcuts')).toBe('Meta+B')
  })
})
