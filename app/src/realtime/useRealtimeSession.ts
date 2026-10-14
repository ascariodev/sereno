import { useEffect } from 'react'
import { AppState } from 'react-native'

import { useOrganizationStore } from '@/organization/store'
import { useProjectsStore } from '@/projects/store'
import { useAuthStore } from '@/session/auth'

import { onReconnect, resumeRealtime, subscribeToUser } from './echo'

function refreshProjects(organizationId?: number): void {
  const activeId = useOrganizationStore.getState().activeId
  if (activeId === null || (organizationId !== undefined && organizationId !== activeId)) return
  void useProjectsStore.getState().load(true)
}

export function useRealtimeSession(): void {
  const userId = useAuthStore((state) => state.user?.id ?? null)

  useEffect(() => {
    if (userId === null) return
    const unsubscribeUser = subscribeToUser(userId, {
      onProjectAccessChanged: (organizationId) => refreshProjects(organizationId),
    })
    const unsubscribeReconnect = onReconnect(() => refreshProjects())
    return () => {
      unsubscribeUser()
      unsubscribeReconnect()
    }
  }, [userId])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') resumeRealtime()
    })
    return () => subscription.remove()
  }, [])
}
