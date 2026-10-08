<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import AppSegmented from '../components/ui/AppSegmented.vue'
import BrandMark from '../components/ui/BrandMark.vue'
import { toast } from '../components/ui/toast'
import { chooseLocale, LOCALE_LABELS, type Locale } from '../i18n'
import { safeRedirect } from '../router/safeRedirect'
import { useAuthStore } from '../stores/auth'

const { t, locale } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const emailInput = ref<HTMLInputElement | null>(null)
const email = ref('')
const password = ref('')
const submitting = ref(false)
const explicitLocale = ref<Locale | null>(null)
const fieldErrors = ref<Record<string, string[]>>({})
const formError = ref<string | null>(null)

function errorIds(field: 'email' | 'password'): string[] {
  return (fieldErrors.value[field] ?? []).map((_, index) => `login-${field}-error-${index}`)
}

function describedBy(field: 'email' | 'password'): string | undefined {
  const ids = errorIds(field)
  return ids.length ? ids.join(' ') : undefined
}

const languageOptions = [
  { value: 'es', label: 'ES', ariaLabel: LOCALE_LABELS.es, lang: 'es' },
  { value: 'en', label: 'EN', ariaLabel: LOCALE_LABELS.en, lang: 'en' },
]

onMounted(() => emailInput.value?.focus())

function onLanguage(value: string): void {
  explicitLocale.value = value as Locale
  chooseLocale(explicitLocale.value)
}

async function submit(): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  fieldErrors.value = {}
  formError.value = null
  try {
    const localeSaved = await auth.login(email.value, password.value, explicitLocale.value)
    if (!localeSaved) toast.error(t('common.localeSaveFailed'))
    await router.push(safeRedirect(route.query.redirect) ?? '/')
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (error.status === 422) {
      fieldErrors.value = error.errors
      if (!error.errors.email?.length && !error.errors.password?.length) {
        formError.value = t('login.failed')
      }
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
    <section class="login__main">
      <header class="login__top">
        <div class="login__brand">
          <BrandMark :size="30" />
          <span class="login__brand-name">{{ t('app.name') }}</span>
        </div>
        <AppSegmented
          :model-value="locale"
          :options="languageOptions"
          :label="t('login.language')"
          @update:model-value="onLanguage"
        />
      </header>

      <div class="login__center">
        <form class="login__form" novalidate @submit.prevent="submit">
          <div class="login__heading">
            <h1>{{ t('login.title') }}</h1>
            <p class="login__subtitle">{{ t('login.subtitle') }}</p>
          </div>

          <div class="login__field">
            <label for="login-email">{{ t('login.email') }}</label>
            <input
              id="login-email"
              ref="emailInput"
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
              :id="`login-email-error-${index}`"
              :key="message"
              class="login__error"
              data-test="error-email"
            >
              {{ message }}
            </p>
          </div>

          <div class="login__field">
            <label for="login-password">{{ t('login.password') }}</label>
            <input
              id="login-password"
              v-model="password"
              type="password"
              name="password"
              autocomplete="current-password"
              required
              :aria-invalid="describedBy('password') ? 'true' : undefined"
              :aria-describedby="describedBy('password')"
            />
            <p
              v-for="(message, index) in fieldErrors.password"
              :id="`login-password-error-${index}`"
              :key="message"
              class="login__error"
              data-test="error-password"
            >
              {{ message }}
            </p>
          </div>

          <p v-if="formError" class="login__error" role="alert" data-test="error-form">{{ formError }}</p>

          <button class="login__submit" type="submit" :disabled="submitting">
            {{ submitting ? t('login.submitting') : t('login.submit') }}
          </button>
          <p class="login__hint">{{ t('login.invited') }}</p>
        </form>
      </div>
    </section>

    <section class="login__hero" aria-labelledby="login-hero-title">
      <div class="login__hero-inner">
        <p id="login-hero-title" class="login__hero-title">{{ t('login.heroTitle') }}</p>
        <p class="login__hero-text">{{ t('login.heroText') }}</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login {
  display: flex;
  flex-wrap: wrap;
  min-height: 100vh;
  background: var(--surface);
  color: var(--ink);
}
.login__main {
  flex: 1 1 440px;
  display: flex;
  flex-direction: column;
  padding: calc(32px + env(safe-area-inset-top)) calc(40px + env(safe-area-inset-right))
    calc(32px + env(safe-area-inset-bottom)) calc(40px + env(safe-area-inset-left));
}
.login__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.login__brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.login__brand-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.login__center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
}
.login__form {
  display: flex;
  flex-direction: column;
  gap: 22px;
  width: 100%;
  max-width: 360px;
}
.login__heading {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.login__heading h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.login__subtitle {
  margin: 0;
  color: var(--ink-2);
  font-size: 15px;
}
.login__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.login__field label {
  font-size: 13px;
  font-weight: 600;
}
.login__field input {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
}
.login__field input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.login__submit {
  min-height: 46px;
  border: 0;
  border-radius: 10px;
  background: var(--ink);
  color: var(--surface);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.login__submit:disabled {
  opacity: 0.6;
  cursor: default;
}
.login__submit:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.login__hint {
  margin: 0;
  color: var(--ink-3);
  font-size: 13px;
  text-align: center;
}
.login__error {
  margin: 0;
  color: var(--level-error-fg);
  font-size: 13px;
}
.login__hero {
  flex: 1 1 520px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  margin: 8px;
  padding: 48px 40px;
  border-radius: 18px;
  background: var(--bg);
}
.login__hero-inner {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 480px;
}
.login__hero-title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}
.login__hero-text {
  margin: 0;
  color: var(--ink-2);
  font-size: 15px;
}
@media (max-width: 600px) {
  .login__main {
    padding: 24px 20px;
  }
}
</style>
