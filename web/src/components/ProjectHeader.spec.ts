import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProjectHeader from './ProjectHeader.vue'

describe('ProjectHeader', () => {
  it('shows key, name, channel and description', () => {
    const wrapper = mount(ProjectHeader, {
      props: { name: 'posveapi', projectKey: 'POSVE', description: 'Sales API', channelName: 'general' },
    })
    expect(wrapper.find('h1').text()).toContain('posveapi')
    expect(wrapper.find('h1').text()).toContain('general')
    expect(wrapper.text()).toContain('POSVE')
    expect(wrapper.text()).toContain('Sales API')
  })

  it('omits the description when null and renders the tabs slot', () => {
    const wrapper = mount(ProjectHeader, {
      props: { name: 'posveapi', projectKey: 'POSVE', description: null },
      slots: { tabs: '<nav data-test="tabs"></nav>' },
    })
    expect(wrapper.find('.project-header__description').exists()).toBe(false)
    expect(wrapper.find('[data-test=tabs]').exists()).toBe(true)
  })
})
