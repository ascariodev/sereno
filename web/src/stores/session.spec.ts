import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { useAuthStore } from './auth'
import { useOrganizationStore } from './organization'
import { useProjectsStore } from './projects'

const project = { id: 1, name: 'Alpha', key: 'K1', description: null, archived_at: null, created_at: '', updated_at: '' }

describe('session teardown', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('clearSession empties the projects store through organization.clear', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      path === '/api/projects'
        ? ({ data: [project], meta: { current_page: 1, last_page: 1, per_page: 100, total: 1 } } as never)
        : ({ data: [{ id: 7, project_id: 1, name: 'K1', archived_at: null }] } as never),
    )
    const auth = useAuthStore()
    const organization = useOrganizationStore()
    const projects = useProjectsStore()
    organization.$patch({ organizations: [{ id: 1 } as never] })
    organization.select(1)
    await flushPromises()
    expect(projects.projects).toHaveLength(1)
    expect(projects.channelByProject).toEqual({ 1: 7 })

    auth.clearSession()
    await flushPromises()

    expect(organization.activeId).toBeNull()
    expect(projects.projects).toEqual([])
    expect(projects.channelByProject).toEqual({})
    expect(projects.loading).toBe(false)
    expect(projects.failed).toBe(false)
  })
})
