<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth'

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const submitting = ref(false)
const fieldErrors = ref<Record<string, string[]>>({})
const formError = ref<string | null>(null)

function redirectTarget(): string {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
    return redirect
  }
  return '/'
}

async function submit(): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  fieldErrors.value = {}
  formError.value = null
  try {
    await auth.login(email.value, password.value)
    await router.push(redirectTarget())
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (error.status === 422) {
      fieldErrors.value = error.errors
    } else if (error.status === 429) {
      formError.value = t('login.tooManyAttempts')
    } else if (error.status === 0) {
      formError.value = t('login.network')
    } else {
      formError.value = t('login.failed')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login">
    <form class="login__form" novalidate @submit.prevent="submit">
      <h1>{{ t('login.title') }}</h1>

      <label for="login-email">{{ t('login.email') }}</label>
      <input
        id="login-email"
        v-model="email"
        type="email"
        name="email"
        autocomplete="username"
        required
      />
      <p v-for="message in fieldErrors.email" :key="message" class="login__error" data-test="error-email">
        {{ message }}
      </p>

      <label for="login-password">{{ t('login.password') }}</label>
      <input
        id="login-password"
        v-model="password"
        type="password"
        name="password"
        autocomplete="current-password"
        required
      />
      <p
        v-for="message in fieldErrors.password"
        :key="message"
        class="login__error"
        data-test="error-password"
      >
        {{ message }}
      </p>

      <p v-if="formError" class="login__error" role="alert" data-test="error-form">{{ formError }}</p>

      <button type="submit" :disabled="submitting">
        {{ submitting ? t('login.submitting') : t('login.submit') }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.login {
  display: grid;
  min-height: 100vh;
  place-items: center;
}

.login__form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(22rem, 90vw);
}

.login__form input {
  padding: 0.5rem;
  font: inherit;
}

.login__form button {
  margin-top: 0.5rem;
  padding: 0.6rem;
  font: inherit;
  cursor: pointer;
}

.login__error {
  margin: 0;
  color: #c0392b;
  font-size: 0.875rem;
}
</style>
