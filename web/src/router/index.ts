import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouterHistory,
} from 'vue-router'
import { ApiError } from '../api/client'
import AppLayout from '../layouts/AppLayout.vue'
import { useAuthStore } from '../stores/auth'
import ChannelView from '../views/ChannelView.vue'
import InviteView from '../views/InviteView.vue'
import LogView from '../views/LogView.vue'
import LoginView from '../views/LoginView.vue'
import ProjectsView from '../views/ProjectsView.vue'
import SessionErrorView from '../views/SessionErrorView.vue'
import { whileLoadingSession } from './redirectToLogin'
import { safeRedirect } from './safeRedirect'

function redirectQuery(to: RouteLocationNormalized) {
  const redirect = safeRedirect(to.name === 'session-error' ? to.query.redirect : to.fullPath)
  return redirect && redirect !== '/' ? { redirect } : {}
}

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
      { path: '/session-error', name: 'session-error', component: SessionErrorView },
      { path: '/invite/:token', name: 'invite', component: InviteView, meta: { anySession: true } },
      {
        path: '/',
        component: AppLayout,
        children: [
          { path: '', name: 'projects', component: ProjectsView },
          { path: 'channels/:id', name: 'channel', component: ChannelView },
          { path: 'projects/:projectId/log', name: 'project-log', component: LogView },
        ],
      },
    ],
  })

  router.beforeEach(async (to) => {
    const auth = useAuthStore()

    if (!auth.isAuthenticated) {
      if (to.meta.public || to.meta.anySession) return true
      return { name: 'login', query: redirectQuery(to) }
    }

    if (to.name === 'session-error') return true

    if (to.meta.public) return { name: 'projects' }

    if (!auth.user) {
      try {
        await whileLoadingSession(router, () => auth.fetchMe())
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
      }
      if (!auth.isAuthenticated) {
        if (to.meta.anySession) return true
        return { name: 'login', query: redirectQuery(to) }
      }
      if (!auth.user) {
        return {
          name: 'session-error',
          query: redirectQuery(to),
        }
      }
    }
    return true
  })

  return router
}
