import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type Router,
  type RouterHistory,
} from 'vue-router'
import { ApiError } from '../api/client'
import AppLayout from '../layouts/AppLayout.vue'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import AccessTokensView from '../views/AccessTokensView.vue'
import ChannelView from '../views/ChannelView.vue'
import IntegrationsView from '../views/IntegrationsView.vue'
import InvitationsView from '../views/InvitationsView.vue'
import InviteView from '../views/InviteView.vue'
import LogView from '../views/LogView.vue'
import LoginView from '../views/LoginView.vue'
import RegisterView from '../views/RegisterView.vue'
import MembersView from '../views/MembersView.vue'
import NotificationsView from '../views/NotificationsView.vue'
import PlanView from '../views/PlanView.vue'
import ProjectsView from '../views/ProjectsView.vue'
import SessionErrorView from '../views/SessionErrorView.vue'
import { whileLoadingSession } from './redirectToLogin'
import { safeRedirect } from './safeRedirect'

function redirectQuery(to: RouteLocationNormalized) {
  const redirect = safeRedirect(to.name === 'session-error' ? to.query.redirect : to.fullPath)
  return redirect && redirect !== '/' ? { redirect } : {}
}

const ORGANIZATION_QUERY = 'organization'

function linkedOrganizationId(value: unknown): number | null {
  return typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value) ? Number(value) : null
}

/** Consumes `?organization=<id>` (email links): activates it before the view loads and drops it from the URL. */
async function withoutLinkedOrganization(router: Router, to: RouteLocationNormalized) {
  if (!(ORGANIZATION_QUERY in to.query)) return null
  const id = linkedOrganizationId(to.query[ORGANIZATION_QUERY])
  if (id !== null) await whileLoadingSession(router, () => useOrganizationStore().activateFromLink(id))
  const query = { ...to.query }
  delete query[ORGANIZATION_QUERY]
  return { path: to.path, query, hash: to.hash, replace: true }
}

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
      { path: '/register', name: 'register', component: RegisterView, meta: { public: true } },
      { path: '/session-error', name: 'session-error', component: SessionErrorView },
      { path: '/invite/:token', name: 'invite', component: InviteView, meta: { anySession: true } },
      {
        path: '/',
        component: AppLayout,
        children: [
          { path: '', name: 'projects', component: ProjectsView },
          { path: 'notifications', name: 'notifications', component: NotificationsView },
          { path: 'mentions', redirect: { name: 'notifications' } },
          { path: 'channels/:id', name: 'channel', component: ChannelView },
          { path: 'projects/:projectId/log', name: 'project-log', component: LogView },
          { path: 'projects/:projectId/plan', name: 'project-plan', component: PlanView },
          { path: 'projects/:projectId/integrations', name: 'project-integrations', component: IntegrationsView },
          { path: 'settings/invitations', name: 'invitations', component: InvitationsView },
          { path: 'settings/members', name: 'members', component: MembersView },
          { path: 'settings/access-tokens', name: 'access-tokens', component: AccessTokensView },
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
    return (await withoutLinkedOrganization(router, to)) ?? true
  })

  return router
}
