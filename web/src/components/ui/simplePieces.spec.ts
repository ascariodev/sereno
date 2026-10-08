import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { i18n } from '../../i18n'
import AppAvatar, { initialsOf, paletteFor } from './AppAvatar.vue'
import LevelPill from './LevelPill.vue'
import ProjectKey from './ProjectKey.vue'
import StatusPill from './StatusPill.vue'

const global = { plugins: [i18n] }

describe('LevelPill', () => {
  it.each(['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'])('shows %s', (level) => {
    const wrapper = mount(LevelPill, { props: { level }, global })
    expect(wrapper.text()).toBe(level)
    expect(wrapper.attributes('data-level')).toBe(level)
  })

  it('translates the text', () => {
    i18n.global.locale.value = 'es'
    const text = mount(LevelPill, { props: { level: 'warning' }, global }).text()
    i18n.global.locale.value = 'en'
    expect(text).not.toBe('warning')
    expect(text.length).toBeGreaterThan(0)
  })

  it('unknown level shows the raw value with the neutral style', () => {
    const wrapper = mount(LevelPill, { props: { level: 'weird' }, global })
    expect(wrapper.text()).toBe('weird')
    expect(wrapper.attributes('data-level')).toBe('debug')
  })
})

describe('StatusPill', () => {
  it('shows the status and falls back to neutral when unknown', () => {
    expect(mount(StatusPill, { props: { status: 'resolved' }, global }).text()).toBe('resolved')
    const unknown = mount(StatusPill, { props: { status: 'zzz' }, global })
    expect(unknown.text()).toBe('zzz')
    expect(unknown.attributes('data-status')).toBe('ignored')
  })
})

describe('AppAvatar', () => {
  it('computes initials', () => {
    expect(initialsOf('Sergio Carrillo')).toBe('SC')
    expect(initialsOf('ana maria lopez')).toBe('AL')
    expect(initialsOf('madonna')).toBe('MA')
    expect(initialsOf('  ')).toBe('?')
  })

  it('color is stable per id', () => {
    expect(paletteFor(7)).toEqual(paletteFor(7))
    expect(paletteFor(1)).not.toEqual(paletteFor(2))
    expect(mount(AppAvatar, { props: { name: 'Sergio Carrillo', id: 1 } }).text()).toBe('SC')
  })

  it('applies the palette tokens to the element', () => {
    const wrapper = mount(AppAvatar, { props: { name: 'Sergio Carrillo', id: 1 } })
    const { bg, fg } = paletteFor(1)
    expect(bg).toMatch(/^var\(--avatar-\d-bg\)$/)
    expect(wrapper.element.style.background).toBe(bg)
    expect(wrapper.element.style.color).toBe(fg)
  })

  it('falls back to a valid palette entry for negative or non numeric ids', () => {
    const valid = [1, 2, 3].map((n) => `var(--avatar-${n}-bg)`)
    expect(paletteFor(-4)).toEqual(paletteFor(4))
    for (const id of [-1, -7, 'abc', 'x-1', '', NaN]) {
      expect(valid).toContain(paletteFor(id).bg)
      expect(paletteFor(id).fg).toMatch(/^var\(--avatar-\d-fg\)$/)
    }
    expect(paletteFor('abc')).toEqual(paletteFor('abc'))
  })
})

describe('ProjectKey', () => {
  it('shows the key', () => {
    expect(mount(ProjectKey, { props: { value: 'POSVE' } }).text()).toBe('POSVE')
  })
})
