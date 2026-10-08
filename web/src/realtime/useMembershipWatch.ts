import { onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { toast } from '../components/ui/toast'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { leaveOrganization, onReconnect, subscribeToUser } from './echo'

const ownLeaves = new Map<number, number>()

/**
 * Marks a leave started from this client: its own `membership.revoked` only cuts the channels, because the
 * screen that left already reloads, notifies and navigates.
 */
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

  async function onMembershipRevoked(organizationId: number): Promise<void> {
    if (ownLeaves.has(organizationId)) {
      leaveOrganization(organizationId)
      return
    }
    const name = organization.organizations.find((o) => o.id === organizationId)?.name
    let activeChanged: boolean
    try {
      activeChanged = await organization.handleMembershipRevoked(organizationId)
    } catch (error) {
      ignoreApiError(error)
      return
    }
    if (!activeChanged) return
    toast.info(name ? t('organization.revoked', { organization: name }) : t('organization.revokedUnknown'))
    await router.replace({ name: 'projects' })
  }

  const unsubscribeReconnect = onReconnect(() => {
    organization.load().catch(ignoreApiError)
  })

  watch(
    () => auth.user?.id,
    (userId) => {
      unsubscribeUser?.()
      unsubscribeUser =
        userId === undefined ? null : subscribeToUser(userId, (organizationId) => void onMembershipRevoked(organizationId))
    },
    { immediate: true },
  )

  onUnmounted(() => {
    unsubscribeUser?.()
    unsubscribeUser = null
    unsubscribeReconnect()
  })
}
