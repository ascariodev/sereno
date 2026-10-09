import { onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api, ApiError } from '../api/client'
import { toast } from '../components/ui/toast'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { leaveOrganization, onReconnect, subscribeToUser } from './echo'

const ownLeaves = new Map<number, number>()
const pendingRevocations = new Map<number, Promise<void>>()

/** Marks a leave started from this client: its own `membership.revoked` only cuts the channels. */
export function expectOwnLeave(organizationId: number): () => void {
  ownLeaves.set(organizationId, (ownLeaves.get(organizationId) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const remaining = (ownLeaves.get(organizationId) ?? 1) - 1
    if (remaining > 0) ownLeaves.set(organizationId, remaining)
    else ownLeaves.delete(organizationId)
  }
}

function ignoreApiError(error: unknown): void {
  if (!(error instanceof ApiError)) throw error
}

export function useMembershipWatch(): void {
  const auth = useAuthStore()
  const organization = useOrganizationStore()
  const router = useRouter()
  const { t } = useI18n()
  let unsubscribeUser: (() => void) | null = null
  let unsubscribeReconnect: (() => void) | null = null

  function revokeOnce(organizationId: number, detect: () => Promise<boolean>): Promise<void> {
    const pending = pendingRevocations.get(organizationId)
    if (pending) return pending
    const name = organization.organizations.find((o) => o.id === organizationId)?.name
    const run = (async () => {
      let activeChanged: boolean
      try {
        activeChanged = await detect()
      } catch (error) {
        ignoreApiError(error)
        return
      }
      if (!activeChanged) return
      toast.info(name ? t('organization.revoked', { organization: name }) : t('organization.revokedUnknown'))
      await router.replace({ name: 'projects' })
    })().finally(() => pendingRevocations.delete(organizationId))
    pendingRevocations.set(organizationId, run)
    return run
  }

  async function onMembershipRevoked(organizationId: number): Promise<void> {
    if (ownLeaves.has(organizationId)) {
      leaveOrganization(organizationId)
      return
    }
    await revokeOnce(organizationId, () => organization.handleMembershipRevoked(organizationId))
  }

  async function onForbidden(organizationId: number): Promise<void> {
    if (ownLeaves.has(organizationId) || organization.activeId !== organizationId) return
    await revokeOnce(organizationId, () => organization.handleForbidden(organizationId))
  }

  async function onMembershipRoleChanged(organizationId: number, role: string): Promise<void> {
    try {
      await organization.handleMembershipRoleChanged(organizationId, role)
    } catch (error) {
      ignoreApiError(error)
    }
  }

  function stopWatching(): void {
    unsubscribeUser?.()
    unsubscribeReconnect?.()
    unsubscribeUser = null
    unsubscribeReconnect = null
  }

  api.setForbiddenHandler((organizationId) => void onForbidden(organizationId))

  watch(
    () => auth.user?.id,
    (userId) => {
      stopWatching()
      if (userId === undefined) return
      unsubscribeUser = subscribeToUser(
        userId,
        (organizationId) => void onMembershipRevoked(organizationId),
        (organizationId, role) => void onMembershipRoleChanged(organizationId, role),
      )
      unsubscribeReconnect = onReconnect(() => {
        organization.load().catch(ignoreApiError)
      })
    },
    { immediate: true },
  )

  onUnmounted(() => {
    stopWatching()
    api.setForbiddenHandler(null)
  })
}
