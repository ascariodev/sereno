import type { Router } from 'vue-router'
import { safeRedirect } from './safeRedirect'

const routersLoadingSession = new WeakSet<Router>()

export async function whileLoadingSession<T>(router: Router, load: () => Promise<T>): Promise<T> {
  routersLoadingSession.add(router)
  try {
    return await load()
  } finally {
    routersLoadingSession.delete(router)
  }
}

export function redirectToLogin(router: Router) {
  if (routersLoadingSession.has(router)) return
  const current = router.currentRoute.value
  if (current.name === 'login' || current.path === '/login') return
  const target = current.name === 'session-error' ? current.query.redirect : current.fullPath
  const redirect = safeRedirect(target)
  const query = redirect && redirect !== '/' ? { redirect } : {}
  void router.push({ name: 'login', query })
}
