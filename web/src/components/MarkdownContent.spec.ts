import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MarkdownContent from './MarkdownContent.vue'

const render = (source: string | null | undefined) => mount(MarkdownContent, { props: { source } })

describe('MarkdownContent', () => {
  it('renders the Markdown structure', () => {
    const wrapper = render('# Title\n\n**bold** and `code`\n\n- one\n- two\n\n> quote')

    expect(wrapper.find('h3').text()).toBe('Title')
    expect(wrapper.find('strong').text()).toBe('bold')
    expect(wrapper.find('code').text()).toBe('code')
    expect(wrapper.findAll('li').map((li) => li.text())).toEqual(['one', 'two'])
    expect(wrapper.find('blockquote').text()).toBe('quote')
  })

  it('opens links in a new tab safely', () => {
    const link = render('[site](https://example.com)').find('a')

    expect(link.attributes('href')).toBe('https://example.com')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })

  it('does not let dangerous HTML reach the DOM', () => {
    const wrapper = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))')

    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('[onerror]').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it.each([[''], [null], [undefined]])('renders nothing for empty source %s', (source) => {
    expect(render(source).find('.markdown-content').exists()).toBe(false)
  })

  it('renders task checkboxes disabled and silent by default', async () => {
    const wrapper = render('- [ ] one\n- [x] two')
    const boxes = wrapper.findAll('input[type="checkbox"]')

    expect(boxes).toHaveLength(2)
    expect(boxes.every((box) => (box.element as HTMLInputElement).disabled)).toBe(true)
    expect(boxes[0].attributes('aria-label')).toBe('one')
    await boxes[0].trigger('change')
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })

  it('emits toggle with the source line when interactive and keeps the box tied to the source', async () => {
    const wrapper = mount(MarkdownContent, { props: { source: 'intro\n\n- [ ] one\n- [x] two', interactive: true } })
    const boxes = wrapper.findAll('input[type="checkbox"]')

    expect((boxes[0].element as HTMLInputElement).disabled).toBe(false)
    ;(boxes[1].element as HTMLInputElement).checked = false
    await boxes[1].trigger('change')
    expect(wrapper.emitted('toggle')).toEqual([[3]])
    expect((boxes[1].element as HTMLInputElement).checked).toBe(true)
  })

  it('restores focus on the same checkbox when the DOM is replaced', async () => {
    const wrapper = mount(MarkdownContent, { props: { source: '- [ ] one\n- [ ] two', interactive: true }, attachTo: document.body })
    const second = wrapper.findAll('input')[1].element as HTMLInputElement
    second.focus()
    expect(document.activeElement).toBe(second)
    await wrapper.setProps({ source: '- [ ] one\n- [x] two' })
    const replaced = wrapper.findAll('input')[1].element as HTMLInputElement
    expect(replaced).not.toBe(second)
    expect(document.activeElement).toBe(replaced)
    wrapper.unmount()
  })
})
