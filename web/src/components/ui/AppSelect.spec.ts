import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppSelect from './AppSelect.vue'

const base = { id: 's', label: 'Role' }
const options = '<option value="a">A</option><option value="b" disabled>B</option><option value="c">C</option>'

describe('AppSelect', () => {
  it('renders options from the slot with v-model, label and attrs', async () => {
    const wrapper = mount(AppSelect, {
      props: { ...base, modelValue: 'c' },
      attrs: { 'data-test': 'x' },
      slots: { default: options },
    })
    const select = wrapper.get('select')
    expect(select.element.value).toBe('c')
    expect(select.attributes('data-test')).toBe('x')
    expect(wrapper.get('label').attributes('for')).toBe('s')
    expect(wrapper.findAll('option')).toHaveLength(3)
    await select.setValue('a')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['a'])
  })

  it('keeps a disabled option disabled', () => {
    const wrapper = mount(AppSelect, { props: base, slots: { default: options } })
    expect(wrapper.findAll('option')[1].attributes('disabled')).toBeDefined()
  })

  it('links errors with aria-invalid and aria-describedby, external id last', () => {
    const wrapper = mount(AppSelect, {
      props: { ...base, errors: ['e1', 'e2'], errorTest: 'err', describedby: 'ext' },
      slots: { default: options },
    })
    const select = wrapper.get('select')
    expect(select.attributes('aria-invalid')).toBe('true')
    expect(select.attributes('aria-describedby')).toBe('s-error-0 s-error-1 ext')
    expect(wrapper.get('#s-error-1').attributes('data-test')).toBe('err')
  })

  it('uses only the external describedby without errors', () => {
    const wrapper = mount(AppSelect, { props: { ...base, describedby: 'ext' }, slots: { default: options } })
    const select = wrapper.get('select')
    expect(select.attributes('aria-describedby')).toBe('ext')
    expect(select.attributes('aria-invalid')).toBeUndefined()
  })

  it('has no aria attributes without errors or describedby', () => {
    const wrapper = mount(AppSelect, { props: base, slots: { default: options } })
    expect(wrapper.get('select').attributes('aria-describedby')).toBeUndefined()
  })

  it('focus() focuses the select', () => {
    const wrapper = mount(AppSelect, { props: base, slots: { default: options }, attachTo: document.body })
    ;(wrapper.vm as unknown as { focus: () => void }).focus()
    expect(document.activeElement).toBe(wrapper.get('select').element)
    wrapper.unmount()
  })
})
