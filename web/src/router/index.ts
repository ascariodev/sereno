import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'
import { ApiError } from '../api/client'
import AppLayout from '../layouts/AppLayout.vue'
import { useAuthStore } from '../stores/auth'
import ChannelView from '../views/ChannelView.vue'
import LoginView from '../views/LoginView.vue'
import ProjectsView from '../views/ProjectsView.vue'
import SessionErrorView from '../views/SessionErrorView.vue'

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
      { path: '/session-error', name: 'session-error', component: SessionErrorView },
      {
        path: '/',
        component: AppLayout,
        children: [
          { path: '', name: 'projects', component: ProjectsView },
          { path: 'channels/:id', name: 'channel', component: ChannelView },
        ],
      },
    ],
  })

  router.beforeEach(async (to) => {
    const auth = useAuthStore()

    if (!auth.isAuthenticated) {
      if (to.meta.public) return true
      return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
    }

    if (to.name === 'session-error') return true

    if (to.meta.public) return { name: 'projects' }

    if (!auth.user) {
      try {
        await auth.fetchMe()
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
      }
      if (!auth.isAuthenticated) return { name: 'login' }
      if (!auth.user) {
        return {
          name: 'session-error',
          query: to.fullPath === '/' ? {} : { redirect: to.fullPath },
        }
      }
    }
    return true
  })

  return router
}
