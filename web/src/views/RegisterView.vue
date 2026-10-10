<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import BrandMark from '../components/ui/BrandMark.vue'
import { useRegistrationStatus } from '../composables/useRegistrationStatus'
import { safeRedirect } from '../router/safeRedirect'
import { useAuthStore } from '../stores/auth'

type Field = 'name' | 'email' | 'password'

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const { enabled, failed, ready, retry } = useRegistrationStatus()

const nameInput = ref<HTMLInputElement | null>(null)
const name = ref('')
const email = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const submitting = ref(false)
const fieldErrors = ref<Record<string, string[]>>({})
const formError = ref<string | null>(null)
let generation = 0

const loginLocation = computed(() => {
  const redirect = safeRedirect(route.query.redirect)
  return { name: 'login', query: redirect ? { redirect } : {} }
})

function errorIds(field: Field): string[] {
  return (fieldErrors.value[field] ?? []).map((_, index) => `register-${field}-error-${index}`)
}

function describedBy(field: Field): string | undefined {
  const ids = errorIds(field)
  return ids.length ? ids.join(' ') : undefined
}

onMounted(async () => {
  const current = generation
  await ready
  await nextTick()
  if (current === generation) nameInput.value?.focus()
})

onUnmounted(() => {
  generation++
})

async function retryStatus(): Promise<void> {
  const current = generation
  await retry()
  await nextTick()
  if (current === generation) nameInput.value?.focus()
}

async function submit(): Promise<void> {
  if (submitting.value) return
  const current = generation
  submitting.value = true
  fieldErrors.value = {}
  formError.value = null
  try {
    await auth.register(name.value, email.value, password.value, passwordConfirmation.value)
    if (current !== generation) return
    await router.push(safeRedirect(route.query.redirect) ?? '/')
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 422) {
      fieldErrors.value = error.errors
      if (error.errors.password?.length) {
        password.value = ''
        passwordConfirmation.value = ''
      }
      const visible = (['name', 'email', 'password'] as const).some((field) => error.errors[field]?.length)
      if (!visible) formError.value = t('register.failed')
    } else if (error.status === 403) {
      formError.value = t('register.closedError')
    } else if (error.status === 429) {
      formError.value = t('register.tooManyAttempts')
    } else if (error.status === 0) {
      formError.value = t('register.network')
    } else {
      formError.value = t('register.failed')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="register">
    <div class="register__brand">
      <BrandMark :size="30" />
      <span class="register__brand-name">{{ t('app.name') }}</span>
    </div>

    <div v-if="failed" class="register__panel" data-test="status-error">
      <h1>{{ t('register.title') }}</h1>
      <p class="register__error" role="alert">{{ t('register.statusError') }}</p>
      <button class="register__submit" type="button" data-test="retry" @click="retryStatus">{{ t('register.retry') }}</button>
      <RouterLink class="register__link" :to="loginLocation">{{ t('register.toLogin') }}</RouterLink>
    </div>

    <p v-else-if="enabled === null" class="register__loading" role="status" data-test="loading">{{ t('common.loading') }}</p>

    <div v-else-if="enabled === false" class="register__panel" data-test="closed">
      <h1>{{ t('register.title') }}</h1>
      <p>{{ t('register.closed') }}</p>
      <RouterLink :to="loginLocation" data-test="login-link">{{ t('register.toLogin') }}</RouterLink>
    </div>

    <form v-else-if="enabled" class="register__panel" novalidate data-test="register-form" @submit.prevent="submit">
      <h1>{{ t('register.title') }}</h1>

      <div class="register__field">
        <label for="register-name">{{ t('register.name') }}</label>
        <input
          id="register-name"
          ref="nameInput"
          v-model="name"
          type="text"
          name="name"
          autocomplete="name"
          required
          :aria-invalid="describedBy('name') ? 'true' : undefined"
          :aria-describedby="describedBy('name')"
        />
        <p
          v-for="(message, index) in fieldErrors.name"
          :id="`register-name-error-${index}`"
          :key="message"
          class="register__error"
          data-test="error-name"
        >
          {{ message }}
        </p>
      </div>

      <div class="register__field">
        <label for="register-email">{{ t('register.email') }}</label>
        <input
          id="register-email"
          v-model="email"
          type="email"
          name="email"
          autocomplete="username"
          required
          :aria-invalid="describedBy('email') ? 'true' : undefined"
          :aria-describedby="describedBy('email')"
        />
        <p
          v-for="(message, index) in fieldErrors.email"
          :id="`register-email-error-${index}`"
          :key="message"
          class="register__error"
          data-test="error-email"
        >
          {{ message }}
        </p>
      </div>

      <div class="register__field">
        <label for="register-password">{{ t('register.password') }}</label>
        <input
          id="register-password"
          v-model="password"
          type="password"
          name="password"
          autocomplete="new-password"
          required
          :aria-invalid="describedBy('password') ? 'true' : undefined"
          :aria-describedby="describedBy('password')"
        />
        <p
          v-for="(message, index) in fieldErrors.password"
          :id="`register-password-error-${index}`"
          :key="message"
          class="register__error"
          data-test="error-password"
        >
          {{ message }}
        </p>
      </div>

      <div class="register__field">
        <label for="register-password-confirmation">{{ t('register.passwordConfirmation') }}</label>
        <input
          id="register-password-confirmation"
          v-model="passwordConfirmation"
          type="password"
          name="password_confirmation"
          autocomplete="new-password"
          required
        />
      </div>

      <p v-if="formError" class="register__error" role="alert" data-test="error-form">{{ formError }}</p>

      <button class="register__submit" type="submit" :disabled="submitting">
        {{ submitting ? t('register.submitting') : t('register.submit') }}
      </button>
      <RouterLink class="register__link" :to="loginLocation" data-test="login-link">
        {{ t('register.haveAccount') }}
      </RouterLink>
    </form>
  </main>
</template>

<style scoped>
.register {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  min-height: 100vh;
  box-sizing: border-box;
  padding: calc(32px + env(safe-area-inset-top)) 20px calc(32px + env(safe-area-inset-bottom));
  background: var(--surface);
  color: var(--ink);
}
.register__brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.register__brand-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.register__panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  max-width: 360px;
}
.register__panel h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.register__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.register__field label {
  font-size: 13px;
  font-weight: 600;
}
.register__field input {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
}
.register__field input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.register__submit {
  min-height: 46px;
  border: 0;
  border-radius: 10px;
  background: var(--ink);
  color: var(--surface);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.register__submit:disabled {
  opacity: 0.6;
  cursor: default;
}
.register__submit:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.register__link {
  color: var(--ink-2);
  font-size: 13px;
  text-align: center;
}
.register__loading {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
}
.register__error {
  margin: 0;
  color: var(--level-error-fg);
  font-size: 13px;
}
</style>
