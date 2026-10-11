import { onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { api, ApiError } from '../api/client'
import { toast } from '../components/ui/toast'
import { useAuthStore } from '../stores/auth'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
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

function reportUnexpected(error: unknown): void {
  console.error(error)
}

export function useMembershipWatch(): void {
  const auth = useAuthStore()
  const organization = useOrganizationStore()
  const projectsStore = useProjectsStore()
  const directory = useMemberDirectoryStore()
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
    onForbidden(activeId).catch(reportUnexpected)
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
    directory.invalidate(projectId)
    if (granted) {
      await projectsStore.refresh()
      return
    }
    const name = projectsStore.projects.find((project) => project.id === projectId)?.name
    const wasOpen = openProjectId() === projectId
    leaveProject(organizationId, projectId, projectsStore.removeProject(projectId))
    const userId = auth.user?.id
    const refreshing = projectsStore.refresh()
    if (wasOpen) {
      refreshing.catch(() => undefined)
      toast.info(name ? t('organization.projectAccessLost', { project: name }) : t('organization.projectAccessLostUnknown'))
      await router.replace({ name: 'projects' })
      if (auth.user?.id !== userId || organization.activeId !== organizationId) return
    }
    await refreshing
  }

  function onTaskAssigned(organizationId: number, projectId: number, taskId: number): void {
    if (organization.activeId !== organizationId) return
    toast.info(t('plan.taskAssigned'), {
      action: {
        label: t('plan.taskAssignedOpen'),
        onSelect: () => void router.push({ name: 'project-plan', params: { projectId }, query: { task: String(taskId) } }),
      },
    })
  }

  function routeStillAllowed(): boolean {
    if (route.name === 'invitations') return organization.canManageInvitations
    if (route.name === 'project-integrations') return organization.canManageLogSources
    return true
  }

  async function onMembershipRoleChanged(organizationId: number, role: string): Promise<void> {
    const openProject = organization.activeId === organizationId ? openProjectId() : null
    const openProjectName = projectsStore.projects.find((project) => project.id === openProject)?.name
    try {
      await organization.handleMembershipRoleChanged(organizationId, role)
      if (organization.activeId !== organizationId) return
      directory.invalidate()
      await projectsStore.refresh()
    } catch (error) {
      ignoreApiError(error)
      return
    }
    if (organization.activeId === organizationId && !routeStillAllowed()) {
      toast.info(t('organization.roleRouteLost'))
      await router.replace({ name: 'projects' })
      return
    }
    if (openProject === null || projectsStore.failed) return
    if (projectsStore.projects.some((project) => project.id === openProject) || openProject in projectsStore.channelByProject) return
    toast.info(openProjectName ? t('organization.projectAccessLost', { project: openProjectName }) : t('organization.projectAccessLostUnknown'))
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

  const forbiddenHandler = (organizationId: number) => void onForbidden(organizationId).catch(reportUnexpected)
  api.setForbiddenHandler(forbiddenHandler)
  const unsubscribeDenied = onChannelDenied((organizationId, status) => {
    if (status === 403) void onForbidden(organizationId).catch(reportUnexpected)
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
        onTaskAssigned,
      })
      leaveSession = joinSession(userId)
      unsubscribeReconnect = onReconnect(onReconnected)
    },
    { immediate: true },
  )

  onUnmounted(() => {
    stopWatching()
    unsubscribeDenied()
    api.clearForbiddenHandler(forbiddenHandler)
  })
}
