import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import { i18n } from '../i18n'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useOrganizationStore } from '../stores/organization'
import ProjectHeader from './ProjectHeader.vue'
import { toast } from './ui/toast'

enableAutoUnmount(afterEach)
afterEach(() => {
  vi.restoreAllMocks()
})

const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)
const qa = (sel: string) => Array.from(document.body.querySelectorAll<HTMLElement>(sel))

function person(id: number, role: 'owner' | 'admin' | 'member') {
  return { id, name: `User ${id}`, email: `u${id}@e.com`, role, joined_at: '2026-10-08T12:00:00Z' }
}

const ownerMember = person(1, 'owner')
const assigned = person(2, 'member')
const free = person(3, 'member')
const organizationMembers = [ownerMember, assigned, free, person(4, 'admin')]

function mountHeader(roles: string[] = ['admin'], projectMembers = [ownerMember, assigned]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useOrganizationStore().$patch({
    organizations: [{ id: 1, name: 'Acme', slug: 'acme', settings: null, roles }],
    activeId: 1,
    loaded: true,
  })
  const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => ({
    data: path === '/api/members' ? organizationMembers : projectMembers,
  }))
  const post = vi.spyOn(api, 'post').mockResolvedValue({ data: free })
  const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined)
  const wrapper = mount(ProjectHeader, {
    attachTo: document.body,
    props: { name: 'Posve', projectKey: 'POSVE', projectId: 5 },
    global: { plugins: [pinia, i18n], stubs: { RouterLink: true } },
  })
  return { wrapper, get, post, del }
}

async function openDialog(wrapper: ReturnType<typeof mountHeader>['wrapper']) {
  await wrapper.get('button[name=project-members]').trigger('click')
  await flushPromises()
}

describe('ProjectMembersDialog', () => {
  it('shows the button to owner and admin but not to member', () => {
    for (const role of ['owner', 'admin']) {
      expect(mountHeader([role]).wrapper.find('button[name=project-members]').exists()).toBe(true)
    }
    expect(mountHeader(['member']).wrapper.find('button[name=project-members]').exists()).toBe(false)
  })

  it('lists who sees the project and lets only members be removed', async () => {
    const { wrapper, get } = mountHeader()
    await openDialog(wrapper)
    expect(get).toHaveBeenCalledWith('/api/projects/5/members', expect.anything())
    expect(qa('[data-test=member]').map((li) => li.querySelector('[data-test=name]')?.textContent)).toEqual(['User 1', 'User 2'])
    expect(qa('[data-test=remove]')).toHaveLength(1)
    expect(qa('[data-test=always]')).toHaveLength(1)
  })

  it('offers only unassigned members of the organization', async () => {
    const { wrapper } = mountHeader()
    await openDialog(wrapper)
    const options = qa('#project-members-select option:not([disabled])')
    expect(options.map((o) => o.textContent?.trim())).toEqual(['User 3 (u3@e.com)'])
  })

  it('assigns the chosen member and removes it from the options', async () => {
    const { wrapper, post } = mountHeader()
    const success = vi.spyOn(toast, 'success')
    const invalidate = vi.spyOn(useMemberDirectoryStore(), 'invalidate')
    await openDialog(wrapper)
    const select = q<HTMLSelectElement>('#project-members-select')!
    select.value = '3'
    select.dispatchEvent(new Event('change'))
    await flushPromises()
    q<HTMLButtonElement>('[data-test=assign]')!.click()
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/api/projects/5/members', { user_id: 3 })
    expect(invalidate).toHaveBeenCalledWith(5)
    expect(qa('[data-test=member] [data-test=name]').map((n) => n.textContent)).toEqual(['User 1', 'User 2', 'User 3'])
    expect(q('[data-test=no-candidates]')).not.toBeNull()
    expect(success).toHaveBeenCalled()
  })

  it('shows the server message on a 422 when assigning', async () => {
    const { wrapper, post } = mountHeader()
    post.mockRejectedValue(new ApiError(422, 'Not allowed.', { user_id: ['Not allowed.'] }))
    await openDialog(wrapper)
    const select = q<HTMLSelectElement>('#project-members-select')!
    select.value = '3'
    select.dispatchEvent(new Event('change'))
    await flushPromises()
    q<HTMLButtonElement>('[data-test=assign]')!.click()
    await flushPromises()
    expect(q('[data-test=action-error]')?.textContent).toContain('Not allowed.')
    expect(q('#project-members-select')?.getAttribute('aria-describedby')).toBe('project-members-error')
  })

  it('reloads the list on a 404 when assigning', async () => {
    const { wrapper, get, post } = mountHeader()
    post.mockRejectedValue(new ApiError(404, 'Not found.', {}))
    await openDialog(wrapper)
    get.mockClear()
    const select = q<HTMLSelectElement>('#project-members-select')!
    select.value = '3'
    select.dispatchEvent(new Event('change'))
    await flushPromises()
    q<HTMLButtonElement>('[data-test=assign]')!.click()
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/api/projects/5/members', expect.anything())
    expect(q('[data-test=action-error]')).toBeNull()
    expect(qa('[data-test=member]')).toHaveLength(2)
  })

  it('reloads the list on a 404 when removing', async () => {
    const { wrapper, get, del } = mountHeader()
    del.mockRejectedValue(new ApiError(404, 'Not found.', {}))
    await openDialog(wrapper)
    get.mockClear()
    get.mockImplementation(async (path: string) => ({
      data: path === '/api/members' ? organizationMembers : [ownerMember],
    }))
    q<HTMLButtonElement>('[data-test=remove]')!.click()
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/api/projects/5/members', expect.anything())
    expect(q('[data-test=action-error]')).toBeNull()
    expect(qa('[data-test=member]')).toHaveLength(1)
  })

  it('shows the server message on a 403 when assigning', async () => {
    const { wrapper, post } = mountHeader()
    post.mockRejectedValue(new ApiError(403, 'Forbidden by server.', {}))
    await openDialog(wrapper)
    const select = q<HTMLSelectElement>('#project-members-select')!
    select.value = '3'
    select.dispatchEvent(new Event('change'))
    await flushPromises()
    q<HTMLButtonElement>('[data-test=assign]')!.click()
    await flushPromises()
    expect(q('[data-test=action-error]')?.textContent).toContain('Forbidden by server.')
  })

  it('removes a member', async () => {
    const { wrapper, del } = mountHeader()
    const invalidate = vi.spyOn(useMemberDirectoryStore(), 'invalidate')
    await openDialog(wrapper)
    q<HTMLButtonElement>('[data-test=remove]')!.click()
    await flushPromises()
    expect(del).toHaveBeenCalledWith('/api/projects/5/members/2')
    expect(invalidate).toHaveBeenCalledWith(5)
    expect(qa('[data-test=member]')).toHaveLength(1)
    expect(qa('#project-members-select option:not([disabled])')).toHaveLength(2)
  })

  it('shows a retryable error when loading fails', async () => {
    const { wrapper, get } = mountHeader()
    get.mockRejectedValueOnce(new ApiError(500, 'boom', {}))
    await openDialog(wrapper)
    expect(q('[data-test=load-failed]')).not.toBeNull()
    q<HTMLButtonElement>('[name=retry]')!.click()
    await flushPromises()
    expect(qa('[data-test=member]')).toHaveLength(2)
  })

  it('ignores a response that arrives after unmounting', async () => {
    const { wrapper, get } = mountHeader()
    let resolve!: (value: unknown) => void
    get.mockImplementation(() => new Promise((r) => (resolve = r)))
    await openDialog(wrapper)
    wrapper.unmount()
    resolve({ data: [] })
    await flushPromises()
    expect(qa('[data-test=member]')).toHaveLength(0)
  })
})
