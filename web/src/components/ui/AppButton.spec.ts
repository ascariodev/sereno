import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppButton from './AppButton.vue'

describe('AppButton', () => {
  it('usa primary y lg por defecto', () => {
    const button = mount(AppButton).get('button')
    expect(button.classes()).toEqual(expect.arrayContaining(['app-button--primary', 'app-button--lg']))
  })

  it('aplica variante y tamaño explícitos', () => {
    const button = mount(AppButton, { props: { variant: 'secondary', size: 'sm' } }).get('button')
    expect(button.classes()).toEqual(expect.arrayContaining(['app-button--secondary', 'app-button--sm']))
    expect(button.classes()).not.toContain('app-button--primary')
    expect(button.classes()).not.toContain('app-button--lg')
  })

  it('aplica el tamaño md', () => {
    expect(mount(AppButton, { props: { size: 'md' } }).get('button').classes()).toContain('app-button--md')
  })

  it('pasa los atributos al button', () => {
    const button = mount(AppButton, {
      attrs: { type: 'submit', disabled: true, 'data-test': 'go', 'aria-label': 'Ir' },
    }).get('button')
    expect(button.attributes('type')).toBe('submit')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('data-test')).toBe('go')
    expect(button.attributes('aria-label')).toBe('Ir')
  })

  it('no fija type por defecto', () => {
    expect(mount(AppButton).get('button').attributes('type')).toBeUndefined()
  })

  it('renderiza el slot', () => {
    expect(mount(AppButton, { slots: { default: 'Guardar' } }).text()).toBe('Guardar')
  })
})
