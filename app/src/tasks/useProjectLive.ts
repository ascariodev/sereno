import { useEffect } from 'react'

import { useOrganizationStore } from '@/organization/store'
import { useMemberDirectoryStore } from '@/projects/members'
import { onReconnect, subscribeToProject } from '@/realtime/echo'

import { useTaskCommentsStore } from './comments'
import { useTasksStore } from './store'

// The board and the task screen can be stacked: one subscription and one reconnect refresh for both.
const holders = new Map<string, { count: number; release: () => void }>()

function join(organizationId: number, projectId: number): () => void {
  const unsubscribe = subscribeToProject(organizationId, projectId, {
    onTaskCreated: (task) => useTasksStore.getState().insert(task),
    onTaskUpdated: (task) => useTasksStore.getState().replace(task),
    onTaskDeleted: (event) => useTasksStore.getState().remove(event.project_id, event.id),
    onTaskCommentCreated: (comment, count) => {
      useTaskCommentsStore.getState().insert(comment)
      if (count !== undefined) useTasksStore.getState().setCommentsCount(comment.task_id, count)
    },
    onTaskCommentUpdated: (comment) => useTaskCommentsStore.getState().replace(comment),
    onTaskCommentDeleted: ({ id, task_id: taskId, comments_count: count }) => {
      useTaskCommentsStore.getState().remove(id)
      useTasksStore.getState().setCommentsCount(taskId, count)
    },
    onMembersChanged: (projectId) => useMemberDirectoryStore.getState().invalidate(projectId),
  })
  const unsubscribeReconnect = onReconnect(() => {
    void useTasksStore.getState().refresh()
    void useTaskCommentsStore.getState().refresh()
  })
  return () => {
    unsubscribe()
    unsubscribeReconnect()
  }
}

function retain(organizationId: number, projectId: number): () => void {
  const key = `${organizationId}:${projectId}`
  let holder = holders.get(key)
  if (holder === undefined) {
    holder = { count: 0, release: join(organizationId, projectId) }
    holders.set(key, holder)
  }
  const current = holder
  current.count++
  let released = false
  return () => {
    if (released) return
    released = true
    current.count--
    if (current.count > 0 || holders.get(key) !== current) return
    holders.delete(key)
    current.release()
  }
}

export function useProjectLive(projectId: number | null): void {
  const organizationId = useOrganizationStore((state) => state.activeId)

  useEffect(() => {
    if (projectId === null || organizationId === null) return
    return retain(organizationId, projectId)
  }, [organizationId, projectId])
}
