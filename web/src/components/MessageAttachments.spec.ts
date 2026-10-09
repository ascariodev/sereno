import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { i18n } from '../i18n'
import type { MessageAttachment } from '../api/types'
import MessageAttachments from './MessageAttachments.vue'

const image: MessageAttachment = {
  id: 1, original_name: 'foto.png', mime: 'image/png', size: 2048, created_at: '2026-03-04T10:30:00Z', url: 'http://api/attachments/1?sig=a',
}
const pdf: MessageAttachment = {
  id: 2, original_name: 'informe.pdf', mime: 'application/pdf', size: 3 * 1024 * 1024, created_at: '2026-03-04T10:30:00Z', url: 'http://api/attachments/2?sig=b',
}

function render(attachments: MessageAttachment[]) {
  return mount(MessageAttachments, { props: { attachments }, global: { plugins: [i18n] } })
}

describe('MessageAttachments', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('renders nothing without attachments', () => {
    const w = render([])
    expect(w.find('ul').exists()).toBe(false)
    expect(w.find('[role="status"]').exists()).toBe(false)
    expect(w.find('.message-attachments-wrap').exists()).toBe(false)
  })

  it('keeps one empty status region mounted until a preview fails', async () => {
    const w = render([image, { ...image, id: 3, url: 'http://api/attachments/3?sig=c' }])
    expect(w.get('[role="status"]').text()).toBe('')
    await w.findAll('img')[0].trigger('error')
    await w.get('img').trigger('error')
    expect(w.findAll('[role="status"]')).toHaveLength(1)
    expect(w.get('[role="status"]').text()).toBe('The preview is no longer available.')
  })

  it('shows a lazy thumbnail linking to the image', () => {
    const w = render([image])
    const img = w.get('img')
    expect(img.attributes('alt')).toBe('foto.png')
    expect(img.attributes('loading')).toBe('lazy')
    expect(img.attributes('src')).toBe(image.url)
    const a = w.get('a')
    expect(a.attributes('href')).toBe(image.url)
    expect(a.attributes('rel')).toContain('noopener')
    expect(w.text()).not.toContain('Download')
  })

  it('shows a file row with name, size and a named download link', () => {
    const w = render([pdf])
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toContain('informe.pdf')
    expect(w.text()).toContain('3 MB')
    const a = w.get('a')
    expect(a.attributes('href')).toBe(pdf.url)
    expect(a.attributes('rel')).toContain('noopener')
    expect(a.attributes('aria-label')).toBe('Download: informe.pdf')
    expect(a.attributes('download')).toBeUndefined()
  })

  it('does not preview non-inline image types', () => {
    const w = render([{ ...image, mime: 'image/svg+xml' }])
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).not.toContain('no longer available')
  })

  it('falls back to the notice and file row when the image fails, without retrying', async () => {
    const w = render([image, pdf])
    await w.get('img').trigger('error')
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toContain('The preview is no longer available.')
    expect(w.text()).toContain('foto.png')
    expect(w.get('a[aria-label="Download: foto.png"]').attributes('href')).toBe(image.url)
    expect(w.findAll('li')).toHaveLength(2)
    expect(w.findAll('[role="status"]')).toHaveLength(1)
    expect(w.get('[role="status"]').text()).toBe('The preview is no longer available.')
  })

  it('retries the preview when the same attachment arrives with a new signed url', async () => {
    const w = render([image])
    await w.get('img').trigger('error')
    expect(w.find('img').exists()).toBe(false)
    const fresh = { ...image, url: 'http://api/attachments/1?sig=new' }
    await w.setProps({ attachments: [fresh] })
    expect(w.get('img').attributes('src')).toBe(fresh.url)
  })
})
