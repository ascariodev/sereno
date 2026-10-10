import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../api/client'
import type { InvitationRole, Organization } from '../api/types'
import { createOrganization } from '../api/organizations'
import { leaveOrganization } from '../realtime/echo'

export const ORGANIZATION_STORAGE_KEY = 'workspace.organization'

function readStoredId(): number | null {
  const raw = localStorage.getItem(ORGANIZATION_STORAGE_KEY)
  const id = raw === null ? NaN : Number(raw)
  return Number.isInteger(id) ? id : null
}

export const useOrganizationStore = defineStore('organization', () => {
  const organizations = ref<Organization[]>([])
  const activeId = ref<number | null>(null)
  const loaded = ref(false)
  const version = ref(0)
  const rolesRevision = ref(0)
  let generation = 0
  let clearCount = 0
  let latestLoad: Promise<void> = Promise.resolve()

  const active = computed(() => organizations.value.find((o) => o.id === activeId.value) ?? null)

  const isOwner = computed(() => !!active.value?.roles.includes('owner'))
  const canManageInvitations = computed(() => isOwner.value || !!active.value?.roles.includes('admin'))

  const isAdmin = computed(() => !!active.value?.roles.includes('admin'))
  const canCreateProject = computed(() => isOwner.value || isAdmin.value)

  /** Mirrors MemberPolicy::updateRole: roles the active user may give to a member currently holding `targetRole`. */
  const assignableRolesFor = computed(() => (targetRole: InvitationRole | null): InvitationRole[] => {
    if (isOwner.value) return ['owner', 'admin', 'member']
    if (isAdmin.value && targetRole !== 'owner') return ['admin', 'member']
    return []
  })

  /** Mirrors MemberPolicy::remove for another member; removing oneself (leaving) is always allowed. */
  const canRemoveMember = computed(() => (targetRole: InvitationRole | null): boolean =>
    isOwner.value || (isAdmin.value && targetRole !== 'owner'),
  )

  function setActive(id: number | null): void {
    if (id === activeId.value) return
    activeId.value = id
    version.value++
    if (id !== null) localStorage.setItem(ORGANIZATION_STORAGE_KEY, String(id))
  }

  async function fetchOrganizations(): Promise<void> {
    const current = ++generation
    const response = await api.get<{ data: Organization[] }>('/api/organizations')
    if (current !== generation) return
    organizations.value = response.data
    loaded.value = true
    const stored = readStoredId()
    const keep = [activeId.value, stored].find((id) => id !== null && response.data.some((o) => o.id === id))
    setActive(keep ?? response.data[0]?.id ?? null)
  }

  function load(): Promise<void> {
    latestLoad = fetchOrganizations()
    return latestLoad
  }

  /** Reloads and waits for the newest load; false when a `clear()` happened meanwhile. */
  async function reloadSettled(): Promise<boolean> {
    const clearsBefore = clearCount
    let awaited = load()
    await awaited
    while (awaited !== latestLoad) {
      awaited = latestLoad
      await awaited
    }
    return clearsBefore === clearCount
  }

  async function handleMembershipRevoked(organizationId: number): Promise<boolean> {
    leaveOrganization(organizationId)
    const previousActiveId = activeId.value
    if (!(await reloadSettled())) return false
    return activeId.value !== previousActiveId
  }

  /** Backup for a lost `membership.revoked`: a 403 only counts as revocation if the reload no longer lists the organization. */
  async function handleForbidden(organizationId: number): Promise<boolean> {
    const previousActiveId = activeId.value
    if (!(await reloadSettled())) return false
    if (organizations.value.some((o) => o.id === organizationId)) return false
    leaveOrganization(organizationId)
    return activeId.value !== previousActiveId
  }

  /** Skips the reload when the store already holds `role` (the change was made from this client). */
  async function handleMembershipRoleChanged(organizationId: number, role: string): Promise<void> {
    const roles = organizations.value.find((o) => o.id === organizationId)?.roles
    if (roles?.length === 1 && roles[0] === role) return
    if (!(await reloadSettled())) return
    if (activeId.value === organizationId) rolesRevision.value++
  }

  function select(id: number): void {
    if (!organizations.value.some((o) => o.id === id)) return
    setActive(id)
  }

  async function create(name: string): Promise<Organization> {
    const clearsBefore = clearCount
    const created = await createOrganization(name)
    if (clearsBefore !== clearCount) return created
    if (!(await reloadSettled())) return created
    select(created.id)
    return created
  }

  function clear(): void {
    generation++
    clearCount++
    organizations.value = []
    loaded.value = false
    setActive(null)
  }

  return { organizations, activeId, active, isOwner, isAdmin, canCreateProject, assignableRolesFor, canRemoveMember, canManageInvitations, loaded, version, rolesRevision, load, handleMembershipRevoked, handleForbidden, handleMembershipRoleChanged, select, create, clear }
})

export function installOrganizationOnApi(): void {
  const organization = useOrganizationStore()
  api.setOrganizationProvider(() => organization.activeId)
}
