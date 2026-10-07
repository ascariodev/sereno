import type { Router } from 'vue-router'
import { safeRedirect } from './safeRedirect'

export function redirectToLogin(router: Router) {
  const current = router.currentRoute.value
  if (current.name === 'login' || current.path === '/login') return
  const target = current.name === 'session-error' ? current.query.redirect : current.fullPath
  const redirect = safeRedirect(target)
  const query = redirect && redirect !== '/' ? { redirect } : {}
  void router.push({ name: 'login', query })
}
