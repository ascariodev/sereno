import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '../../i18n'
import { LOG_LEVELS } from '../../api/logLevels'
import Sparkline from './Sparkline.vue'

const global = { plugins: [i18n] }

afterEach(() => {
  i18n.global.locale.value = 'en'
})

function series(overrides: Record<number, number> = {}): number[] {
  return Array.from({ length: 24 }, (_, index) => overrides[index] ?? 0)
}

function pointList(wrapper: ReturnType<typeof mount>): Array<[number, number]> {
  const raw = wrapper.get('polyline').attributes('points')!
  return raw.split(' ').map((pair) => pair.split(',').map(Number) as [number, number])
}

describe('Sparkline', () => {
  it('draws one point per hour with the peak at the top and the empty hours at the bottom', () => {
    const wrapper = mount(Sparkline, { props: { counts: series({ 23: 4, 10: 2 }) }, global })
    const points = pointList(wrapper)

    expect(points).toHaveLength(24)
    expect(points[23]![0]).toBeGreaterThan(points[0]![0])
    expect(points[23]![1]).toBeLessThan(points[10]![1])
    expect(points[10]![1]).toBeLessThan(points[0]![1])
    expect(new Set([points[0]![1], points[5]![1]]).size).toBe(1)
  })

  it('renders an all-zero series as a flat line', () => {
    const wrapper = mount(Sparkline, { props: { counts: series() }, global })
    const ys = new Set(pointList(wrapper).map(([, y]) => y))

    expect(ys.size).toBe(1)
    expect(wrapper.attributes('data-flat')).toBe('true')
  })

  it('hides the svg from assistive tech and exposes the 24 h total as text', () => {
    const wrapper = mount(Sparkline, { props: { counts: series({ 3: 2, 4: 3 }) }, global })

    expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true')
    expect(wrapper.text()).toBe('5 events in the last 24 hours')
  })

  it('uses the singular for one event and zero events', () => {
    expect(mount(Sparkline, { props: { counts: series({ 0: 1 }) }, global }).text()).toBe('1 event in the last 24 hours')
    expect(mount(Sparkline, { props: { counts: series() }, global }).text()).toBe('0 events in the last 24 hours')
  })

  it('translates the accessible text to Spanish', () => {
    i18n.global.locale.value = 'es'

    expect(mount(Sparkline, { props: { counts: series({ 0: 1 }) }, global }).text()).toBe('1 evento en las últimas 24 horas')
    expect(mount(Sparkline, { props: { counts: series({ 0: 7 }) }, global }).text()).toBe('7 eventos en las últimas 24 horas')
  })

  it.each(LOG_LEVELS)('colors the %s level with its own token', (level) => {
    const wrapper = mount(Sparkline, { props: { counts: series({ 0: 1 }), level }, global })

    expect(wrapper.attributes('data-level')).toBe(level)
    expect(wrapper.classes()).toContain(`sparkline--${level}`)
  })

  it('falls back to the neutral tone for a missing or unknown level', () => {
    expect(mount(Sparkline, { props: { counts: series() }, global }).attributes('data-level')).toBe('debug')
    expect(mount(Sparkline, { props: { counts: series(), level: 'nope' }, global }).attributes('data-level')).toBe('debug')
  })

  it('renders no line for an empty series', () => {
    const wrapper = mount(Sparkline, { props: { counts: [] }, global })

    expect(wrapper.find('polyline').exists()).toBe(false)
    expect(wrapper.text()).toBe('0 events in the last 24 hours')
  })
})
