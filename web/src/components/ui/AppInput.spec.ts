import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppInput from './AppInput.vue'

const base = { id: 'f', label: 'Name' }

describe('AppInput', () => {
  it('renders an input with v-model, attrs and label', async () => {
    const wrapper = mount(AppInput, { props: { ...base, modelValue: 'a' }, attrs: { maxlength: '5', 'data-test': 'x' } })
    const input = wrapper.get('input')
    expect(input.element.value).toBe('a')
    expect(input.attributes('maxlength')).toBe('5')
    expect(input.attributes('data-test')).toBe('x')
    expect(wrapper.get('label').attributes('for')).toBe('f')
    await input.setValue('b')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['b'])
  })

  it('renders a textarea when multiline with v-model, attrs and errors', async () => {
    const wrapper = mount(AppInput, {
      props: { ...base, multiline: true, rows: 5, modelValue: 'a', errors: ['bad'], errorTest: 'err' },
      attrs: { maxlength: '9' },
    })
    expect(wrapper.find('input').exists()).toBe(false)
    const area = wrapper.get('textarea')
    expect(area.element.value).toBe('a')
    expect(area.attributes('rows')).toBe('5')
    expect(area.attributes('maxlength')).toBe('9')
    expect(area.attributes('aria-invalid')).toBe('true')
    expect(area.attributes('aria-describedby')).toBe('f-error-0')
    expect(wrapper.get('#f-error-0').attributes('data-test')).toBe('err')
    await area.setValue('b')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['b'])
  })

  it('puts the hint before the errors in aria-describedby', () => {
    const wrapper = mount(AppInput, {
      props: { ...base, errors: ['e1', 'e2'], describedby: 'ext' },
      slots: { hint: 'Some hint' },
    })
    expect(wrapper.get('#f-hint').text()).toBe('Some hint')
    expect(wrapper.get('input').attributes('aria-describedby')).toBe('f-hint f-error-0 f-error-1 ext')
  })

  it('joins describedby without errors and without invalid state', () => {
    const wrapper = mount(AppInput, { props: { ...base, describedby: 'ext' } })
    const input = wrapper.get('input')
    expect(input.attributes('aria-describedby')).toBe('ext')
    expect(input.attributes('aria-invalid')).toBeUndefined()
  })

  it('has no aria-describedby when nothing describes it', () => {
    const wrapper = mount(AppInput, { props: base })
    expect(wrapper.get('input').attributes('aria-describedby')).toBeUndefined()
  })

  it.each([false, true])('focus() focuses the field (multiline %s)', (multiline) => {
    const wrapper = mount(AppInput, { props: { ...base, multiline }, attachTo: document.body })
    ;(wrapper.vm as unknown as { focus: () => void }).focus()
    expect(document.activeElement).toBe(wrapper.get(multiline ? 'textarea' : 'input').element)
    wrapper.unmount()
  })
})
