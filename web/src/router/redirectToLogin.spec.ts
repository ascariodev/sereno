import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { redirectToLogin, whileLoadingSession } from './redirectToLogin'

const Stub = { template: '<div />' }

async function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Stub },
      { path: '/login', name: 'login', component: Stub },
      { path: '/projects', name: 'projects', component: Stub },
    ],
  })
  await router.push('/projects')
  return router
}

describe('whileLoadingSession', () => {
  it('suppresses redirectToLogin while loading', async () => {
    const router = await makeRouter()

    await whileLoadingSession(router, async () => {
      redirectToLogin(router)
      await router.isReady()
    })

    expect(router.currentRoute.value.name).toBe('projects')
  })

  it('releases the lock when load throws', async () => {
    const router = await makeRouter()

    await expect(
      whileLoadingSession(router, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom')

    redirectToLogin(router)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(router.currentRoute.value.name).toBe('login')
  })
})
