import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { i18n } from '../i18n'
import { useOrganizationStore } from '../stores/organization'
import OrgSwitcher from './OrgSwitcher.vue'

let wrapper: VueWrapper | undefined

beforeEach(() => setActivePinia(createPinia()))

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

function label(): string | null {
  wrapper = mount(OrgSwitcher, { global: { plugins: [i18n] }, attachTo: document.body })
  return document.querySelector('button[name=organization]')!.getAttribute('aria-label')
}

describe('OrgSwitcher', () => {
  it('names the active organization in the label', () => {
    const store = useOrganizationStore()
    store.organizations = [{ id: 1, name: 'One', slug: 'one', settings: null, roles: ['owner'] }]
    store.activeId = 1
    expect(label()).toBe(`${i18n.global.t('organization.label')}: One`)
  })

  it('has no trailing separator when no organization is active', () => {
    const store = useOrganizationStore()
    store.organizations = [{ id: 1, name: 'One', slug: 'one', settings: null, roles: ['owner'] }]
    store.activeId = null
    expect(label()).toBe(i18n.global.t('organization.label'))
  })

  it('emits create from the new organization item without changing the active one', async () => {
    const store = useOrganizationStore()
    store.organizations = [{ id: 1, name: 'One', slug: 'one', settings: null, roles: ['owner'] }]
    store.activeId = 1
    label()
    const button = document.querySelector<HTMLButtonElement>('button[name=organization]')!
    button.focus()
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await flushPromises()
    const item = document.querySelector<HTMLElement>('[role^=menuitem][data-value="create"]')!
    expect(item.textContent).toContain('New organization')
    item.focus()
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(wrapper!.emitted('create')).toHaveLength(1)
    expect(store.activeId).toBe(1)
  })
})
