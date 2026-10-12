import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppFormError from './AppFormError.vue'

describe('AppFormError', () => {
  it('renders a paragraph with role alert, its class and the slot', () => {
    const wrapper = mount(AppFormError, { slots: { default: 'Something failed' } })

    const root = wrapper.get('p')
    expect(root.attributes('role')).toBe('alert')
    expect(root.classes()).toContain('app-form-error')
    expect(root.text()).toBe('Something failed')
  })

  it('passes data-test and id to the paragraph', () => {
    const wrapper = mount(AppFormError, {
      attrs: { 'data-test': 'error-form', id: 'form-error' },
      slots: { default: 'Oops' },
    })

    const root = wrapper.get('[data-test=error-form]')
    expect(root.element.tagName).toBe('P')
    expect(root.attributes('id')).toBe('form-error')
  })
})
