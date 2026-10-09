import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { i18n } from '../i18n'
import MessageBody from './MessageBody.vue'
import MessageItem from './MessageItem.vue'
import type { Message } from '../api/types'

type Props = InstanceType<typeof MessageBody>['$props']

function render(props: Props) {
  return mount(MessageBody, { props, global: { plugins: [i18n] } })
}

// text() trims each node of a fragment root; textContent of a real parent keeps the whitespace.
function rawText(props: Props) {
  const host = defineComponent({ render: () => h('p', [h(MessageBody, props)]) })
  return mount(host, { global: { plugins: [i18n] } }).element.textContent
}

const diego = { id: 12, name: 'Diego' }

describe('MessageBody', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('renders plain text without chips', () => {
    const w = render({ body: 'Hello world', mentions: [] })
    expect(w.text()).toBe('Hello world')
    expect(w.findAll('[data-mention]')).toHaveLength(0)
  })

  it('renders a null body as empty', () => {
    expect(render({ body: null }).text()).toBe('')
  })

  it('turns a token into a chip with the name from mentions', () => {
    const w = render({ body: 'Hi <@12>, check this', mentions: [diego] })
    const chips = w.findAll('[data-mention]')
    expect(chips).toHaveLength(1)
    expect(chips[0].text()).toBe('@Diego')
    expect(rawText({ body: 'Hi <@12>, check this', mentions: [diego] })).toBe('Hi @Diego, check this')
  })

  it('shows a translated generic label for a token without entry', () => {
    const w = render({ body: 'Hi <@99>', mentions: [diego] })
    expect(w.get('[data-mention]').text()).toBe('@user')
    i18n.global.locale.value = 'es'
    expect(render({ body: 'Hola <@99>', mentions: [] }).get('[data-mention]').text()).toBe('@usuario')
  })

  it('handles adjacent and repeated tokens', () => {
    const w = render({ body: '<@12><@7><@12>', mentions: [diego, { id: 7, name: 'Ana' }] })
    expect(w.findAll('[data-mention]').map((c) => c.text())).toEqual(['@Diego', '@Ana', '@Diego'])
  })

  it('does not treat invalid tokens as mentions', () => {
    for (const body of ['<@0>', '<@abc>', '<@012>', '<@>', '<@12', '@12>', '<@-1>', '<@1234567890123456789>']) {
      const w = render({ body, mentions: [diego, { id: 0, name: 'Zero' }] })
      expect(w.findAll('[data-mention]'), body).toHaveLength(0)
      expect(w.text()).toBe(body)
    }
  })

  it('keeps stray angle brackets as literal text', () => {
    const props = { body: 'a < b > c <@12> d <b>x</b> <', mentions: [diego] }
    expect(rawText(props)).toBe('a < b > c @Diego d <b>x</b> <')
    expect(render(props).find('b').exists()).toBe(false)
  })

  it('never injects HTML, not even from a mention name', () => {
    const w = render({ body: '<img src=x onerror=alert(1)> <@12>', mentions: [{ id: 12, name: '<script>x</script>' }] })
    expect(w.find('img').exists()).toBe(false)
    expect(w.find('script').exists()).toBe(false)
    expect(w.get('[data-mention]').text()).toBe('@<script>x</script>')
  })

  it('keeps emojis around tokens', () => {
    expect(rawText({ body: '👍<@12>👨‍👩‍👧 ok', mentions: [diego] })).toBe('👍@Diego👨‍👩‍👧 ok')
  })

  it('preserves line breaks in the text', () => {
    expect(rawText({ body: 'one\n<@12>\ntwo', mentions: [diego] })).toBe('one\n@Diego\ntwo')
  })

  it('highlights only the own mention', () => {
    const w = render({ body: '<@12> <@7>', mentions: [diego, { id: 7, name: 'Ana' }], ownUserId: 7 })
    const [first, second] = w.findAll('[data-mention]')
    expect(first.classes()).not.toContain('mention-chip--own')
    expect(second.classes()).toContain('mention-chip--own')
  })

  it('highlights an own token even without entry in mentions', () => {
    const w = render({ body: '<@7>', mentions: [], ownUserId: 7 })
    expect(w.get('[data-mention]').classes()).toContain('mention-chip--own')
  })

  it('is used by MessageItem with its own-user-id', () => {
    const message: Message = {
      id: 1,
      channel_id: 1,
      kind: 'user',
      body: 'Hi <@12>',
      payload: null,
      log_group_id: null,
      parent_id: null,
      replies_count: 0,
      recent_participants: [],
      last_reply_at: null,
      mentions: [diego],
      attachments: [],
      user: { id: 7, name: 'Ana' },
      created_at: '2026-03-04T10:30:00Z',
      edited_at: null,
      deleted_at: null,
    }
    const w = mount(MessageItem, { props: { message, ownUserId: 12 }, global: { plugins: [i18n] } })
    const chip = w.get('.message-item__body [data-mention]')
    expect(chip.text()).toBe('@Diego')
    expect(chip.classes()).toContain('mention-chip--own')
  })
})
