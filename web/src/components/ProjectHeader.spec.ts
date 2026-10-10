import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { i18n } from '../i18n'
import ProjectHeader from './ProjectHeader.vue'

describe('ProjectHeader', () => {
  it('shows key, name, channel and description', () => {
    const wrapper = mount(ProjectHeader, {
      props: { name: 'posveapi', projectKey: 'POSVE', description: 'Sales API', channelName: 'general' },
      global: { plugins: [i18n], stubs: { RouterLink: true } },
    })
    expect(wrapper.find('h1').text()).toContain('posveapi')
    expect(wrapper.find('h1').text()).toContain('general')
    expect(wrapper.text()).toContain('POSVE')
    expect(wrapper.text()).toContain('Sales API')
  })

  it('omits the description when null and renders the tabs slot', () => {
    const wrapper = mount(ProjectHeader, {
      props: { name: 'posveapi', projectKey: 'POSVE', description: null },
      global: { plugins: [i18n], stubs: { RouterLink: true } },
      slots: { tabs: '<nav data-test="tabs"></nav>' },
    })
    expect(wrapper.find('.project-header__description').exists()).toBe(false)
    expect(wrapper.find('[data-test=tabs]').exists()).toBe(true)
  })

  it('renders Channel, Plan and Log tabs as links and marks the current one', async () => {
    const stub = { template: '<div />' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/channels/:id', name: 'channel', component: stub },
        { path: '/projects/:projectId/plan', name: 'project-plan', component: stub },
        { path: '/projects/:projectId/log', name: 'project-log', component: stub },
      ],
    })
    await router.push('/projects/5/log?status=all')
    const wrapper = mount(ProjectHeader, {
      props: { name: 'posveapi', projectKey: 'POSVE', projectId: 5, channelId: 7 },
      global: { plugins: [router, i18n] },
    })
    const tabs = wrapper.findAll('nav[aria-label="Project views"] a')
    expect(tabs.map((tab) => tab.attributes('href'))).toEqual(['/channels/7', '/projects/5/plan', '/projects/5/log'])
    expect(tabs[0].attributes('aria-current')).toBeUndefined()
    expect(tabs[1].attributes('aria-current')).toBeUndefined()
    expect(tabs[2].attributes('aria-current')).toBe('page')
  })

  it('shows the Channel tab as disabled without a channel and no tabs without a project id', async () => {
    const stub = { template: '<div />' }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/projects/:projectId/plan', name: 'project-plan', component: stub }, { path: '/projects/:projectId/log', name: 'project-log', component: stub }] })
    await router.push('/projects/5/log')
    const withoutChannel = mount(ProjectHeader, {
      props: { name: 'a', projectKey: 'A', projectId: 5, channelId: null },
      global: { plugins: [router, i18n] },
    })
    expect(withoutChannel.findAll('nav a')).toHaveLength(2)
    expect(withoutChannel.find('[aria-disabled=true]').text()).toBe('Channel')
    const withoutId = mount(ProjectHeader, { props: { name: 'a', projectKey: 'A' }, global: { plugins: [i18n], stubs: { RouterLink: true } } })
    expect(withoutId.find('nav').exists()).toBe(false)
  })
})
