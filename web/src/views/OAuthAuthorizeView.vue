<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ApiError } from '../api/client'
import {
  approveOAuthAuthorization,
  denyOAuthAuthorization,
  fetchOAuthAuthorization,
  type OAuthAuthorization,
  type OAuthQuery,
  type OAuthRedirect,
} from '../api/oauth'
import AppButton from '../components/ui/AppButton.vue'
import AppFormError from '../components/ui/AppFormError.vue'
import AppSelect from '../components/ui/AppSelect.vue'
import BrandMark from '../components/ui/BrandMark.vue'
import { ORGANIZATION_STORAGE_KEY } from '../stores/organization'

type LoadError = 'invalid' | 'failed'

const { t } = useI18n()
const route = useRoute()

const query = computed<OAuthQuery>(() => {
  const result: OAuthQuery = {}
  for (const [key, value] of Object.entries(route.query)) {
    const last = Array.isArray(value) ? value[value.length - 1] : value
    if (typeof last === 'string') result[key] = last
  }
  return result
})

const authorization = ref<OAuthAuthorization | null>(null)
const loading = ref(false)
const loadError = ref<LoadError | null>(null)
const loadMessage = ref<string | null>(null)
const organizationId = ref('')
const acting = ref<'approve' | 'deny' | null>(null)
const redirecting = ref(false)
const actionError = ref<string | null>(null)
let generation = 0
let controller: AbortController | null = null

const clientName = computed(() => authorization.value?.client.name || t('oauthAuthorize.unknownClient'))
const host = computed(() => authorization.value?.redirect_host || t('oauthAuthorize.unknownHost'))
const busy = computed(() => acting.value !== null || redirecting.value)
const canApprove = computed(() => organizationId.value !== '' && !busy.value)

function defaultOrganizationId(organizations: OAuthAuthorization['organizations']): string {
  const stored = Number(localStorage.getItem(ORGANIZATION_STORAGE_KEY))
  const match = organizations.find((organization) => organization.id === stored) ?? organizations[0]
  return match ? String(match.id) : ''
}

async function load(): Promise<void> {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  authorization.value = null
  loadError.value = null
  loadMessage.value = null
  actionError.value = null
  loading.value = true
  try {
    const result = await fetchOAuthAuthorization(query.value, controller.signal)
    if (current !== generation) return
    authorization.value = result
    organizationId.value = defaultOrganizationId(result.organizations)
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    loadError.value = error.status === 400 ? 'invalid' : 'failed'
    loadMessage.value = error.status === 400 ? error.message : null
  } finally {
    if (current === generation) loading.value = false
  }
}

function goTo(response: OAuthRedirect): boolean {
  let url: URL
  try {
    url = new URL(response.redirect_url)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  redirecting.value = true
  window.location.assign(url.toString())
  return true
}

async function act(kind: 'approve' | 'deny'): Promise<void> {
  if (busy.value || !authorization.value) return
  if (kind === 'approve' && organizationId.value === '') return
  const current = generation
  acting.value = kind
  actionError.value = null
  try {
    const response =
      kind === 'approve'
        ? await approveOAuthAuthorization(query.value, Number(organizationId.value))
        : await denyOAuthAuthorization(query.value)
    if (current !== generation) return
    if (!goTo(response)) actionError.value = t('oauthAuthorize.actionFailed')
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 400) {
      authorization.value = null
      loadError.value = 'invalid'
      loadMessage.value = error.message
    } else if (error.status === 0) {
      actionError.value = t('oauthAuthorize.network')
    } else {
      actionError.value = t('oauthAuthorize.actionFailed')
    }
  } finally {
    if (current === generation) acting.value = null
  }
}

void load()

onUnmounted(() => {
  generation++
  controller?.abort()
})
</script>

<template>
  <main class="oauth">
    <header class="oauth__brand">
      <BrandMark :size="30" />
      <span class="oauth__brand-name">{{ t('app.name') }}</span>
    </header>

    <section class="oauth__card">
      <p v-if="loading" data-test="loading">{{ t('common.loading') }}</p>

      <template v-else-if="loadError === 'invalid'">
        <h1>{{ t('oauthAuthorize.invalid') }}</h1>
        <p v-if="loadMessage" role="alert" data-test="invalid">{{ loadMessage }}</p>
      </template>

      <template v-else-if="loadError === 'failed'">
        <h1>{{ t('oauthAuthorize.loadFailed') }}</h1>
        <AppButton type="button" data-test="retry" @click="load">{{ t('oauthAuthorize.retry') }}</AppButton>
      </template>

      <template v-else-if="authorization">
        <h1>{{ t('oauthAuthorize.title', { client: clientName }) }}</h1>
        <p data-test="description">{{ t('oauthAuthorize.description', { client: clientName }) }}</p>
        <p class="oauth__return" data-test="return-to">
          {{ t('oauthAuthorize.returnTo') }} <strong class="oauth__host" data-test="redirect-host">{{ host }}</strong>
        </p>
        <p class="oauth__scope" data-test="scope">{{ t('oauthAuthorize.scope') }}</p>

        <p v-if="!authorization.organizations.length" role="alert" data-test="no-organizations">
          {{ t('oauthAuthorize.noOrganizations') }}
        </p>
        <AppSelect
          v-else
          id="oauth-organization"
          v-model="organizationId"
          :label="t('oauthAuthorize.organization')"
          :disabled="busy"
          data-test="organization"
        >
          <option v-for="organization in authorization.organizations" :key="organization.id" :value="String(organization.id)">
            {{ organization.name }}
          </option>
        </AppSelect>

        <AppFormError v-if="actionError" data-test="action-error">{{ actionError }}</AppFormError>
        <p v-if="redirecting" role="status" data-test="redirecting">{{ t('oauthAuthorize.redirecting', { host }) }}</p>

        <div class="oauth__actions">
          <AppButton type="button" variant="secondary" :disabled="busy" data-test="deny" @click="act('deny')">
            {{ acting === 'deny' ? t('oauthAuthorize.denying') : t('oauthAuthorize.deny') }}
          </AppButton>
          <AppButton type="button" :disabled="!canApprove" data-test="approve" @click="act('approve')">
            {{ acting === 'approve' ? t('oauthAuthorize.approving') : t('oauthAuthorize.approve') }}
          </AppButton>
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
.oauth {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  min-height: 100vh;
  box-sizing: border-box;
  padding: calc(32px + env(safe-area-inset-top)) 20px calc(32px + env(safe-area-inset-bottom));
  background: var(--bg);
  color: var(--ink);
}
.oauth__brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.oauth__brand-name {
  font-size: 16px;
  font-weight: 700;
}
.oauth__card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 440px;
  box-sizing: border-box;
  padding: 28px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
}
.oauth__card h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.oauth__card p {
  margin: 0;
}
.oauth__host {
  overflow-wrap: anywhere;
  font-size: 16px;
  font-weight: 700;
}
.oauth__scope {
  color: var(--ink-2);
  font-size: 14px;
}
.oauth__actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}
</style>
