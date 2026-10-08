<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { acceptInvitation, previewInvitation } from '../api/invitations'
import type { InvitationPreview } from '../api/types'
import BrandMark from '../components/ui/BrandMark.vue'
import { toast } from '../components/ui/toast'
import { useAuthStore } from '../stores/auth'
import { ORGANIZATION_STORAGE_KEY, useOrganizationStore } from '../stores/organization'

type LoadError = 'unusable' | 'failed'

const { t, locale } = useI18n()
const auth = useAuthStore()
const organization = useOrganizationStore()
const route = useRoute()
const router = useRouter()

const token = computed(() => String(route.params.token ?? ''))
const preview = ref<InvitationPreview | null>(null)
const loading = ref(false)
const loadError = ref<LoadError | null>(null)
const accepting = ref(false)
const signingOut = ref(false)
const acceptError = ref<string | null>(null)
const sessionExpired = ref(false)
const registered = ref(false)
const registering = ref(false)
const name = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const fieldErrors = ref<Record<string, string[]>>({})
const formError = ref<string | null>(null)
type RegisterField = 'name' | 'password'
let generation = 0
let controller: AbortController | null = null

const emailMatches = computed(
  () => !!preview.value && !!auth.user && auth.user.email.toLowerCase() === preview.value.email.toLowerCase(),
)

const expiresAt = computed(() =>
  preview.value
    ? new Date(preview.value.expires_at).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
    : '',
)

async function load(): Promise<void> {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  preview.value = null
  loadError.value = null
  acceptError.value = null
  sessionExpired.value = false
  registered.value = false
  formError.value = null
  fieldErrors.value = {}
  loading.value = true
  try {
    const result = await previewInvitation(token.value, controller.signal)
    if (current !== generation) return
    preview.value = result
  } catch (error) {
    if (current !== generation) return
    loadError.value = error instanceof ApiError && error.status === 404 ? 'unusable' : 'failed'
  } finally {
    if (current === generation) loading.value = false
  }
}

watch(token, () => void load(), { immediate: true })

onUnmounted(() => {
  generation++
  controller?.abort()
})

async function selectOrganization(id: number): Promise<void> {
  try {
    await organization.load()
    organization.select(id)
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    organization.clear()
    localStorage.setItem(ORGANIZATION_STORAGE_KEY, String(id))
  }
}

async function accept(): Promise<void> {
  if (accepting.value || !preview.value) return
  const current = generation
  const organizationName = preview.value.organization.name
  accepting.value = true
  acceptError.value = null
  try {
    const { organization_id } = await acceptInvitation(token.value)
    await selectOrganization(organization_id)
    if (current !== generation) return
    toast.success(t('invite.joined', { organization: organizationName }))
    await router.push({ name: 'projects' })
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 401) {
      sessionExpired.value = true
    } else if (error.status === 422) {
      preview.value = null
      loadError.value = 'unusable'
    } else if (error.status === 403) {
      acceptError.value = t('invite.wrongEmail')
    } else if (error.status === 0) {
      acceptError.value = t('invite.network')
    } else {
      acceptError.value = t('invite.acceptFailed')
    }
  } finally {
    accepting.value = false
  }
}

function errorIds(field: RegisterField): string[] {
  return (fieldErrors.value[field] ?? []).map((_, index) => `invite-${field}-error-${index}`)
}

function describedBy(field: RegisterField): string | undefined {
  const ids = errorIds(field)
  return ids.length ? ids.join(' ') : undefined
}

async function register(): Promise<void> {
  if (registering.value || accepting.value || !preview.value) return
  const current = generation
  const invitedEmail = preview.value.email
  registering.value = true
  fieldErrors.value = {}
  formError.value = null
  try {
    await auth.register(name.value, invitedEmail, password.value, passwordConfirmation.value)
    if (current !== generation) return
    registered.value = true
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 422) {
      fieldErrors.value = error.errors
      if (error.errors.password?.length) {
        password.value = ''
        passwordConfirmation.value = ''
      }
      if (!Object.values(error.errors).some((messages) => messages.length)) formError.value = t('invite.registerFailed')
    } else if (error.status === 429) {
      formError.value = t('invite.tooManyAttempts')
    } else if (error.status === 0) {
      formError.value = t('invite.network')
    } else {
      formError.value = t('invite.registerFailed')
    }
    return
  } finally {
    registering.value = false
  }
  await accept()
}

async function signOut(): Promise<void> {
  if (signingOut.value) return
  signingOut.value = true
  try {
    await auth.logout()
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <main class="invite">
    <header class="invite__brand">
      <BrandMark :size="30" />
      <span class="invite__brand-name">{{ t('app.name') }}</span>
    </header>

    <section class="invite__card">
      <p v-if="loading" data-test="loading">{{ t('common.loading') }}</p>

      <template v-else-if="loadError === 'unusable'">
        <h1>{{ t('invite.unusableTitle') }}</h1>
        <p role="alert" data-test="unusable">{{ t('invite.unusable') }}</p>
        <p v-if="registered" role="alert" data-test="registered-unusable">{{ t('invite.accountCreatedUnusable') }}</p>
        <RouterLink to="/" class="invite__link" data-test="home">{{ t('invite.home') }}</RouterLink>
      </template>

      <template v-else-if="loadError === 'failed'">
        <h1>{{ t('invite.title') }}</h1>
        <p role="alert" data-test="load-failed">{{ t('invite.loadFailed') }}</p>
        <button type="button" class="invite__button" data-test="retry" @click="load">
          {{ t('common.retry') }}
        </button>
      </template>

      <template v-else-if="preview">
        <h1>{{ t('invite.heading', { organization: preview.organization.name }) }}</h1>
        <dl class="invite__details">
          <div>
            <dt>{{ t('invite.email') }}</dt>
            <dd data-test="email">{{ preview.email }}</dd>
          </div>
          <div>
            <dt>{{ t('invite.role') }}</dt>
            <dd data-test="role">{{ t(`invite.roles.${preview.role}`) }}</dd>
          </div>
          <div>
            <dt>{{ t('invite.expires') }}</dt>
            <dd>{{ expiresAt }}</dd>
          </div>
        </dl>

        <template v-if="sessionExpired">
          <p role="alert" data-test="session-expired">{{ t('invite.sessionExpired') }}</p>
          <RouterLink
            :to="{ name: 'login', query: { redirect: route.fullPath } }"
            class="invite__link"
            data-test="sign-in"
          >
            {{ t('invite.signIn') }}
          </RouterLink>
        </template>

        <template v-else-if="auth.isAuthenticated && auth.user">
          <template v-if="emailMatches">
            <p v-if="registered" role="status" data-test="registered-not-joined">
              {{ t('invite.accountCreatedNotJoined') }}
            </p>
            <button
              type="button"
              class="invite__button"
              data-test="accept"
              :disabled="accepting"
              @click="accept"
            >
              {{ accepting ? t('invite.accepting') : t('invite.accept') }}
            </button>
          </template>
          <template v-else>
            <p role="alert" data-test="other-email">
              {{ t('invite.otherEmail', { current: auth.user.email, invited: preview.email }) }}
            </p>
            <button
              type="button"
              class="invite__button"
              data-test="sign-out"
              :disabled="signingOut"
              @click="signOut"
            >
              {{ t('invite.signOut') }}
            </button>
          </template>
          <p v-if="acceptError" class="invite__error" role="alert" data-test="accept-error">{{ acceptError }}</p>
        </template>

        <form v-else class="invite__form" novalidate data-test="register-form" @submit.prevent="register">
          <h2>{{ t('invite.createTitle') }}</h2>

          <div class="invite__field">
            <label for="invite-name">{{ t('invite.name') }}</label>
            <input
              id="invite-name"
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
              :id="`invite-name-error-${index}`"
              :key="message"
              class="invite__error"
              data-test="error-name"
            >
              {{ message }}
            </p>
          </div>

          <div class="invite__field">
            <label for="invite-email">{{ t('invite.email') }}</label>
            <input id="invite-email" type="email" name="email" autocomplete="username" readonly :value="preview.email" />
            <p v-for="message in fieldErrors.email" :key="message" class="invite__error" data-test="error-email">
              {{ message }}
            </p>
          </div>

          <div class="invite__field">
            <label for="invite-password">{{ t('invite.password') }}</label>
            <input
              id="invite-password"
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
              :id="`invite-password-error-${index}`"
              :key="message"
              class="invite__error"
              data-test="error-password"
            >
              {{ message }}
            </p>
          </div>

          <div class="invite__field">
            <label for="invite-password-confirmation">{{ t('invite.passwordConfirmation') }}</label>
            <input
              id="invite-password-confirmation"
              v-model="passwordConfirmation"
              type="password"
              name="password_confirmation"
              autocomplete="new-password"
              required
            />
          </div>

          <p v-if="formError" class="invite__error" role="alert" data-test="error-form">{{ formError }}</p>

          <button type="submit" class="invite__button" data-test="register" :disabled="registering || accepting">
            {{ registering || accepting ? t('invite.creating') : t('invite.createAccount') }}
          </button>

          <p class="invite__alt">
            {{ t('invite.haveAccount') }}
            <RouterLink
              :to="{ name: 'login', query: { redirect: route.fullPath } }"
              class="invite__link"
              data-test="sign-in-instead"
            >
              {{ t('invite.signInInstead') }}
            </RouterLink>
          </p>
        </form>
      </template>
    </section>
  </main>
</template>

<style scoped>
.invite {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  min-height: 100vh;
  box-sizing: border-box;
  padding: calc(32px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right))
    calc(32px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left));
  background: var(--surface);
  color: var(--ink);
}
.invite__brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.invite__brand-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.invite__card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  max-width: 420px;
}
.invite__card h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.invite__card p {
  margin: 0;
  color: var(--ink-2);
}
.invite__details {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
}
.invite__details div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
}
.invite__details dt {
  color: var(--ink-3);
  font-size: 13px;
}
.invite__details dd {
  margin: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
  text-align: right;
}
.invite__button {
  min-height: 46px;
  border: 0;
  border-radius: 10px;
  background: var(--ink);
  color: var(--surface);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.invite__button:disabled {
  opacity: 0.6;
  cursor: default;
}
.invite__button:focus-visible,
.invite__link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.invite__link {
  color: var(--accent);
  font-weight: 600;
}
.invite__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.invite__form h2 {
  margin: 0;
  font-size: 18px;
}
.invite__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.invite__field label {
  font-size: 13px;
  font-weight: 600;
}
.invite__field input {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
}
.invite__field input[readonly] {
  color: var(--ink-3);
}
.invite__field input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.invite__card .invite__alt {
  font-size: 13px;
  text-align: center;
}
.invite__card .invite__error {
  color: var(--level-error-fg);
  font-size: 13px;
}
</style>
