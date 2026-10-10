import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import CopyButton from './CopyButton.vue'
import { toast } from './toast'

enableAutoUnmount(afterEach)

function mountButton() {
  return mount(CopyButton, { props: { text: 'wsk_secret', label: 'Copy key' }, global: { plugins: [i18n] } })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CopyButton', () => {
  it('writes the text to the clipboard and toasts success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const success = vi.spyOn(toast, 'success').mockReturnValue(0)
    const wrapper = mountButton()
    expect(wrapper.get('button').attributes('aria-label')).toBe('Copy key')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('wsk_secret')
    expect(success).toHaveBeenCalledTimes(1)
  })

  it('toasts an error when the clipboard rejects', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const success = vi.spyOn(toast, 'success').mockReturnValue(0)
    const error = vi.spyOn(toast, 'error').mockReturnValue(0)
    const wrapper = mountButton()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledTimes(1)
    expect(success).not.toHaveBeenCalled()
  })

  it('toasts an error when the Clipboard API is missing', async () => {
    Object.assign(navigator, { clipboard: undefined })
    const error = vi.spyOn(toast, 'error').mockReturnValue(0)
    const wrapper = mountButton()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledTimes(1)
  })
})
