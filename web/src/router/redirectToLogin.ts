import type { Router } from 'vue-router'

function isLocalPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}

export function redirectToLogin(router: Router) {
  const current = router.currentRoute.value
  if (current.name === 'login' || current.path === '/login') return
  const target = current.name === 'session-error' ? current.query.redirect : current.fullPath
  const query = isLocalPath(target) && target !== '/' ? { redirect: target } : {}
  void router.push({ name: 'login', query })
}
