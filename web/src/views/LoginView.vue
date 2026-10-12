<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { useRegistrationStatus } from '../composables/useRegistrationStatus'
import AppButton from '../components/ui/AppButton.vue'
import AppFormError from '../components/ui/AppFormError.vue'
import AppInput from '../components/ui/AppInput.vue'
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

const { enabled: registrationOpen } = useRegistrationStatus()
const registerLocation = computed(() => {
  const redirect = safeRedirect(route.query.redirect)
  return redirect ? { name: 'register', query: { redirect } } : { name: 'register' }
})

const emailInput = ref<InstanceType<typeof AppInput> | null>(null)
const email = ref('')
const password = ref('')
const submitting = ref(false)
const explicitLocale = ref<Locale | null>(null)
const fieldErrors = ref<Record<string, string[]>>({})
const formError = ref<string | null>(null)

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

          <AppInput
            id="login-email"
            :label="t('login.email')"
            ref="emailInput"
            v-model="email"
            type="email"
            name="email"
            autocomplete="username"
            required
            :errors="fieldErrors.email"
            error-test="error-email"
          />

          <AppInput
            id="login-password"
            :label="t('login.password')"
            v-model="password"
            type="password"
            name="password"
            autocomplete="current-password"
            required
            :errors="fieldErrors.password"
            error-test="error-password"
          />

          <AppFormError v-if="formError" data-test="error-form">{{ formError }}</AppFormError>

          <AppButton type="submit" :disabled="submitting">
            {{ submitting ? t('login.submitting') : t('login.submit') }}
          </AppButton>
          <RouterLink v-if="registrationOpen" class="login__link" :to="registerLocation" data-test="register-link">
            {{ t('login.noAccount') }}
          </RouterLink>
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
.login__hint {
  margin: 0;
  color: var(--ink-3);
  font-size: 13px;
  text-align: center;
}
.login__link {
  color: var(--ink-2);
  font-size: 13px;
  text-align: center;
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
