import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { api } from '../api/client'
import { i18n } from '../i18n'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'
import AppSidebar from './AppSidebar.vue'

const stub = { template: '<div />' }

async function mountAt(path: string) {
  vi.spyOn(api, 'get').mockReturnValue(new Promise(() => {}))
  const pinia = createPinia()
  setActivePinia(pinia)
  useOrganizationStore().activeId = 1
  const projects = useProjectsStore()
  projects.projects = [
    { id: 5, name: 'posveapi', key: 'POSVE', description: null, archived_at: null, tasks_resolve_log_groups: false, created_at: '', updated_at: '' },
    { id: 6, name: 'other', key: 'OTHER', description: null, archived_at: null, tasks_resolve_log_groups: false, created_at: '', updated_at: '' },
  ]
  projects.channelByProject = { 5: 7, 6: 8 }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'projects', component: stub },
      { path: '/notifications', name: 'notifications', component: stub },
      { path: '/channels/:id', name: 'channel', component: stub },
      { path: '/projects/:projectId/log', name: 'project-log', component: stub },
      { path: '/projects/:projectId/plan', name: 'project-plan', component: stub },
      { path: '/projects/:projectId/integrations', name: 'project-integrations', component: stub },
    ],
  })
  await router.push(path)
  return mount(AppSidebar, { global: { plugins: [pinia, router, i18n] } })
}

describe('AppSidebar active project', () => {
  it.each(['/projects/5/log', '/projects/5/plan', '/projects/5/integrations', '/channels/7'])(
    'marks the project as current on %s',
    async (path) => {
      const wrapper = await mountAt(path)
      const rows = wrapper.findAll('.app-sidebar__project')
      expect(rows[0].attributes('aria-current')).toBe('page')
      expect(rows[1].attributes('aria-current')).toBeUndefined()
    },
  )
})
