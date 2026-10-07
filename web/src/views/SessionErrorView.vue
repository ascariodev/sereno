<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { redirectToLogin } from '../router/redirectToLogin'
import { useAuthStore } from '../stores/auth'

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const retrying = ref(false)
const failed = ref(false)

function redirectTarget(): string {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
    return redirect
  }
  return '/'
}

async function retry(): Promise<void> {
  if (retrying.value) return
  retrying.value = true
  failed.value = false
  try {
    await auth.fetchMe()
    await router.push(redirectTarget())
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (auth.isAuthenticated) {
      failed.value = true
    } else {
      redirectToLogin(router)
    }
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <main class="session-error">
    <h1>{{ t('sessionError.title') }}</h1>
    <p>{{ t('sessionError.message') }}</p>
    <p v-if="failed" class="session-error__failed" role="alert" data-test="error-retry">
      {{ t('sessionError.failed') }}
    </p>
    <button type="button" :disabled="retrying" data-test="retry" @click="retry">
      {{ retrying ? t('sessionError.retrying') : t('sessionError.retry') }}
    </button>
  </main>
</template>

<style scoped>
.session-error {
  display: grid;
  min-height: 100vh;
  place-content: center;
  justify-items: center;
  gap: 0.75rem;
  text-align: center;
}

.session-error p {
  margin: 0;
}

.session-error__failed {
  color: #c0392b;
  font-size: 0.875rem;
}

.session-error button {
  padding: 0.6rem 1rem;
  font: inherit;
  cursor: pointer;
}
</style>
