import { onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { api, ApiError } from '../api/client'
import { toast } from '../components/ui/toast'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'
import { joinSession, leaveOrganization, leaveProject, onChannelDenied, onReconnect, subscribeToUser } from './echo'

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
  const projectsStore = useProjectsStore()
  const router = useRouter()
  const route = useRoute()
  const { t } = useI18n()
  let unsubscribeUser: (() => void) | null = null
  let unsubscribeReconnect: (() => void) | null = null
  let leaveSession: (() => void) | null = null

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

  function onReconnected(): void {
    const activeId = organization.activeId
    if (activeId === null || ownLeaves.has(activeId)) {
      organization.load().catch(ignoreApiError)
      return
    }
    void onForbidden(activeId)
  }

  function openProjectId(): number | null {
    if (route.name === 'project-log' || route.name === 'project-plan') return Number(route.params.projectId)
    if (route.name !== 'channel') return null
    const channelId = Number(route.params.id)
    const entry = Object.entries(projectsStore.channelByProject).find(([, id]) => id === channelId)
    return entry ? Number(entry[0]) : null
  }

  async function onProjectAccessChanged(organizationId: number, projectId: number, granted: boolean): Promise<void> {
    if (organization.activeId !== organizationId) return
    if (granted) {
      await projectsStore.refresh()
      return
    }
    const name = projectsStore.projects.find((project) => project.id === projectId)?.name
    const wasOpen = openProjectId() === projectId
    leaveProject(organizationId, projectId, projectsStore.removeProject(projectId))
    if (wasOpen) {
      toast.info(name ? t('organization.projectAccessLost', { project: name }) : t('organization.projectAccessLostUnknown'))
      await router.replace({ name: 'projects' })
    }
    await projectsStore.refresh()
  }

  async function onMembershipRoleChanged(organizationId: number, role: string): Promise<void> {
    const openProject = organization.activeId === organizationId ? openProjectId() : null
    try {
      await organization.handleMembershipRoleChanged(organizationId, role)
      if (organization.activeId !== organizationId) return
      await projectsStore.refresh()
    } catch (error) {
      ignoreApiError(error)
      return
    }
    if (openProject === null || projectsStore.failed) return
    if (projectsStore.projects.some((project) => project.id === openProject) || openProject in projectsStore.channelByProject) return
    toast.info(t('organization.projectAccessLostUnknown'))
    await router.replace({ name: 'projects' })
  }

  function stopWatching(): void {
    unsubscribeUser?.()
    unsubscribeReconnect?.()
    leaveSession?.()
    unsubscribeUser = null
    unsubscribeReconnect = null
    leaveSession = null
  }

  api.setForbiddenHandler((organizationId) => void onForbidden(organizationId))
  const unsubscribeDenied = onChannelDenied((organizationId, status) => {
    if (status === 403) void onForbidden(organizationId)
  })

  watch(
    () => auth.user?.id,
    (userId) => {
      stopWatching()
      if (userId === undefined) return
      unsubscribeUser = subscribeToUser(userId, {
        onMembershipRevoked: (organizationId) => void onMembershipRevoked(organizationId),
        onRoleChanged: (organizationId, role) => void onMembershipRoleChanged(organizationId, role),
        onProjectAccessChanged: (organizationId, projectId, granted) =>
          void onProjectAccessChanged(organizationId, projectId, granted).catch(ignoreApiError),
      })
      leaveSession = joinSession(userId)
      unsubscribeReconnect = onReconnect(onReconnected)
    },
    { immediate: true },
  )

  onUnmounted(() => {
    stopWatching()
    unsubscribeDenied()
    api.setForbiddenHandler(null)
  })
}
