<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  createAccessToken,
  listAccessTokens,
  listOauthConnections,
  revokeAccessToken,
  revokeOauthConnection,
} from '../api/accessTokens'
import { ApiError } from '../api/client'
import type { AccessToken, AccessTokenExpiryDays, OauthConnection } from '../api/types'
import AppButton from '../components/ui/AppButton.vue'
import AppDialog from '../components/ui/AppDialog.vue'
import AppFormError from '../components/ui/AppFormError.vue'
import AppInput from '../components/ui/AppInput.vue'
import AppSelect from '../components/ui/AppSelect.vue'
import CopyButton from '../components/ui/CopyButton.vue'
import { toast } from '../components/ui/toast'
import { config } from '../config'
import { useOrganizationStore } from '../stores/organization'

const EXPIRY_OPTIONS = ['never', '30', '90', '365'] as const

const { t, locale } = useI18n()
const organization = useOrganizationStore()

const tokens = ref<AccessToken[]>([])
const loading = ref(false)
const failed = ref(false)
const pending = ref<AccessToken | null>(null)
const revoking = ref(false)
const connections = ref<OauthConnection[]>([])
const connectionsLoading = ref(false)
const connectionsFailed = ref(false)
const pendingConnection = ref<OauthConnection | null>(null)
const disconnecting = ref(false)
const createOpen = ref(false)
const issued = ref<string | null>(null)
const name = ref('')
const expiry = ref<(typeof EXPIRY_OPTIONS)[number]>('never')
const submitting = ref(false)
const fieldErrors = ref<Record<string, string[]>>({})
const formError = ref<string | null>(null)
const nameInput = ref<InstanceType<typeof AppInput> | null>(null)
let generation = 0
let controller: AbortController | null = null
let connectionsController: AbortController | null = null
const root = ref<HTMLElement | null>(null)
const tokensTitle = ref<HTMLElement | null>(null)
const connectionsTitle = ref<HTMLElement | null>(null)
let focusAfterRemoval: (() => HTMLElement | null) | null = null

const mcpUrl = computed(() => `${config.apiUrl}/mcp`)
const connectCommand = computed(
  () => `claude mcp add --transport http sereno ${mcpUrl.value} --header "Authorization: Bearer ${issued.value ?? ''}"`,
)

const confirmOpen = computed({
  get: () => pending.value !== null,
  set: (open: boolean) => {
    if (!open && !revoking.value) pending.value = null
  },
})

const disconnectOpen = computed({
  get: () => pendingConnection.value !== null,
  set: (open: boolean) => {
    if (!open && !disconnecting.value) pendingConnection.value = null
  },
})

const createDialogOpen = computed({
  get: () => createOpen.value,
  set: (open: boolean) => {
    if (!open && submitting.value) return
    createOpen.value = open
  },
})

const issuedOpen = computed({
  get: () => issued.value !== null,
  set: (open: boolean) => {
    if (!open) issued.value = null
  },
})

function formatDate(value: string): string {
  return new Date(value).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
}

function isExpired(token: AccessToken): boolean {
  return token.expires_at !== null && new Date(token.expires_at).getTime() <= Date.now()
}

function resetForm(): void {
  name.value = ''
  expiry.value = 'never'
  submitting.value = false
  fieldErrors.value = {}
  formError.value = null
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function loadConnections(current: number, signal: AbortSignal): Promise<void> {
  connectionsFailed.value = false
  connectionsLoading.value = true
  try {
    const result = await listOauthConnections(signal)
    if (current !== generation) return
    connections.value = result
  } catch (error) {
    if (isAbort(error)) return
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    connectionsFailed.value = true
  } finally {
    if (current === generation) connectionsLoading.value = false
  }
}

function retryConnections(): void {
  if (connectionsLoading.value) return
  connectionsController?.abort()
  connectionsController = new AbortController()
  void loadConnections(generation, connectionsController.signal)
}

async function load(): Promise<void> {
  const current = ++generation
  controller?.abort()
  connectionsController?.abort()
  connectionsController = null
  controller = new AbortController()
  const { signal } = controller
  tokens.value = []
  connections.value = []
  pending.value = null
  pendingConnection.value = null
  createOpen.value = false
  issued.value = null
  resetForm()
  failed.value = false
  loading.value = true
  void loadConnections(current, signal)
  try {
    const result = await listAccessTokens(signal)
    if (current !== generation) return
    tokens.value = result
  } catch (error) {
    if (isAbort(error)) return
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    failed.value = true
  } finally {
    if (current === generation) loading.value = false
  }
}

watch(() => organization.activeId, () => void load(), { immediate: true })

watch(createOpen, (value) => {
  resetForm()
  if (value) void nextTick(() => nameInput.value?.focus())
})

onUnmounted(() => {
  generation++
  controller?.abort()
  connectionsController?.abort()
})

function setExpiry(value: string): void {
  expiry.value = value as (typeof EXPIRY_OPTIONS)[number]
}

async function submit(): Promise<void> {
  if (submitting.value) return
  const current = generation
  submitting.value = true
  fieldErrors.value = {}
  formError.value = null
  try {
    const days = expiry.value === 'never' ? null : (Number(expiry.value) as AccessTokenExpiryDays)
    const created = await createAccessToken(name.value.trim(), days)
    if (current !== generation) {
      toast.info(t('accessTokens.createdElsewhere', { name: created.data.name }))
      return
    }
    tokens.value = [created.data, ...tokens.value]
    issued.value = created.token
    createOpen.value = false
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 422) {
      fieldErrors.value = error.errors
      if (!error.errors.name?.length && !error.errors.expires_in_days?.length) formError.value = error.message
    } else if (error.status === 403) {
      formError.value = t('accessTokens.createForbidden')
    } else if (error.status === 0) {
      formError.value = t('accessTokens.network')
    } else {
      formError.value = t('accessTokens.createFailed')
    }
  } finally {
    if (current === generation) submitting.value = false
  }
}

function neighborOf<T extends { id: number }>(items: T[], id: number): T | undefined {
  const index = items.findIndex((item) => item.id === id)
  return items[index + 1] ?? items[index - 1]
}

function planFocusAfterRemoval(neighborId: number | undefined, rowAttr: string, buttonTest: string, title: typeof tokensTitle): void {
  focusAfterRemoval = () =>
    (neighborId === undefined ? null : root.value?.querySelector<HTMLElement>(`[${rowAttr}="${neighborId}"] [data-test="${buttonTest}"]`)) ??
    title.value
}

function returnFocus(event: Event): void {
  const resolve = focusAfterRemoval
  focusAfterRemoval = null
  const target = resolve?.()
  if (!target) return
  event.preventDefault()
  target.focus()
}

async function confirmRevoke(): Promise<void> {
  const target = pending.value
  if (!target || revoking.value) return
  const current = generation
  revoking.value = true
  try {
    await revokeAccessToken(target.id)
    if (current !== generation) return
    planFocusAfterRemoval(neighborOf(tokens.value, target.id)?.id, 'data-token-id', 'revoke', tokensTitle)
    tokens.value = tokens.value.filter((token) => token.id !== target.id)
    toast.success(t('accessTokens.revoked', { name: target.name }))
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 404) {
      planFocusAfterRemoval(neighborOf(tokens.value, target.id)?.id, 'data-token-id', 'revoke', tokensTitle)
      tokens.value = tokens.value.filter((token) => token.id !== target.id)
      toast.info(t('accessTokens.revokeGone'))
    } else {
      toast.error(t('accessTokens.revokeFailed'))
    }
  } finally {
    revoking.value = false
    if (current === generation) pending.value = null
  }
}

async function confirmDisconnect(): Promise<void> {
  const target = pendingConnection.value
  if (!target || disconnecting.value) return
  const current = generation
  disconnecting.value = true
  try {
    await revokeOauthConnection(target.id)
    if (current !== generation) return
    planFocusAfterRemoval(neighborOf(connections.value, target.id)?.id, 'data-connection-id', 'disconnect', connectionsTitle)
    connections.value = connections.value.filter((connection) => connection.id !== target.id)
    toast.success(t('accessTokens.disconnected', { name: target.client.name }))
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 404) {
      planFocusAfterRemoval(neighborOf(connections.value, target.id)?.id, 'data-connection-id', 'disconnect', connectionsTitle)
      connections.value = connections.value.filter((connection) => connection.id !== target.id)
      toast.info(t('accessTokens.disconnectGone'))
    } else {
      toast.error(t('accessTokens.disconnectFailed'))
    }
  } finally {
    disconnecting.value = false
    if (current === generation) pendingConnection.value = null
  }
}
</script>

<template>
  <section ref="root" class="tokens">
    <header class="tokens__header">
      <h1 ref="tokensTitle" class="tokens__title" tabindex="-1">{{ t('accessTokens.title') }}</h1>
      <AppButton type="button" size="md" data-test="create" :disabled="loading" @click="createOpen = true">
        {{ t('accessTokens.create') }}
      </AppButton>
    </header>
    <p class="tokens__description">{{ t('accessTokens.description') }}</p>
    <p v-if="loading" data-test="loading">{{ t('common.loading') }}</p>
    <p v-else-if="failed" role="alert" data-test="load-failed">
      {{ t('accessTokens.loadFailed') }}
      <button type="button" name="retry" @click="load">{{ t('common.retry') }}</button>
    </p>
    <p v-else-if="tokens.length === 0" class="tokens__empty" data-test="empty">{{ t('accessTokens.empty') }}</p>
    <ul v-else class="tokens__list">
      <li v-for="token in tokens" :key="token.id" class="tokens__item" data-test="token" :data-token-id="token.id">
        <div class="tokens__main">
          <strong class="tokens__name" data-test="name">{{ token.name }}</strong>
          <span v-if="isExpired(token)" class="tokens__expired" data-test="expired">{{ t('accessTokens.expired') }}</span>
        </div>
        <dl class="tokens__details">
          <div>
            <dt>{{ t('accessTokens.lastUsed') }}</dt>
            <dd data-test="last-used">{{ token.last_used_at ? formatDate(token.last_used_at) : t('accessTokens.neverUsed') }}</dd>
          </div>
          <div>
            <dt>{{ t('accessTokens.expires') }}</dt>
            <dd data-test="expires">{{ token.expires_at ? formatDate(token.expires_at) : t('accessTokens.neverExpires') }}</dd>
          </div>
        </dl>
        <button
          type="button"
          class="tokens__revoke"
          data-test="revoke"
          :aria-label="`${t('accessTokens.revoke')} ${token.name}`"
          @click="pending = token"
        >
          {{ t('accessTokens.revoke') }}
        </button>
      </li>
    </ul>

    <section class="tokens__connections" data-test="connections">
      <h2 ref="connectionsTitle" class="tokens__subtitle" tabindex="-1">{{ t('accessTokens.connections') }}</h2>
      <p class="tokens__description">{{ t('accessTokens.connectionsDescription') }}</p>
      <p v-if="connectionsLoading" data-test="connections-loading">{{ t('common.loading') }}</p>
      <p v-else-if="connectionsFailed" role="alert" data-test="connections-load-failed">
        {{ t('accessTokens.connectionsLoadFailed') }}
        <button type="button" name="retry-connections" @click="retryConnections">{{ t('common.retry') }}</button>
      </p>
      <p v-else-if="connections.length === 0" class="tokens__empty" data-test="connections-empty">
        {{ t('accessTokens.connectionsEmpty') }}
      </p>
      <ul v-else class="tokens__list">
        <li v-for="connection in connections" :key="connection.id" class="tokens__item" data-test="connection" :data-connection-id="connection.id">
          <div class="tokens__main">
            <strong class="tokens__name" data-test="connection-name">{{ connection.client.name }}</strong>
          </div>
          <dl class="tokens__details">
            <div>
              <dt>{{ t('accessTokens.connectedOn') }}</dt>
              <dd data-test="connection-date">{{ formatDate(connection.created_at) }}</dd>
            </div>
          </dl>
          <button
            type="button"
            class="tokens__revoke"
            data-test="disconnect"
            :aria-label="`${t('accessTokens.disconnect')} ${connection.client.name}`"
            @click="pendingConnection = connection"
          >
            {{ t('accessTokens.disconnect') }}
          </button>
        </li>
      </ul>
    </section>

    <AppDialog v-model:open="createDialogOpen" :title="t('accessTokens.createTitle')" :close-label="t('accessTokens.cancel')">
      <form class="tokens__form" novalidate @submit.prevent="submit">
        <AppInput
          id="token-name"
          ref="nameInput"
          v-model="name"
          :label="t('accessTokens.name')"
          :errors="fieldErrors.name"
          error-test="error-name"
          name="name"
          autocomplete="off"
          maxlength="100"
          :placeholder="t('accessTokens.namePlaceholder')"
          required
        />
        <AppSelect
          id="token-expiry"
          :model-value="expiry"
          :label="t('accessTokens.expiration')"
          :errors="fieldErrors.expires_in_days"
          error-test="error-expiry"
          name="expires_in_days"
          @update:model-value="setExpiry"
        >
          <option v-for="option in EXPIRY_OPTIONS" :key="option" :value="option">
            {{ option === 'never' ? t('accessTokens.expiryNever') : t(`accessTokens.expiry${option}`) }}
          </option>
        </AppSelect>
        <AppFormError v-if="formError" data-test="error-form">{{ formError }}</AppFormError>
        <div class="tokens__actions">
          <AppButton type="button" variant="secondary" size="md" data-test="cancel" :disabled="submitting" @click="createDialogOpen = false">
            {{ t('accessTokens.cancel') }}
          </AppButton>
          <AppButton type="submit" size="md" data-test="submit" :disabled="submitting">
            {{ submitting ? t('accessTokens.creating') : t('accessTokens.submit') }}
          </AppButton>
        </div>
      </form>
    </AppDialog>

    <AppDialog v-model:open="issuedOpen" :title="t('accessTokens.issuedTitle')" :close-label="t('accessTokens.close')">
      <div v-if="issued" class="tokens__issued">
        <p class="tokens__warning" role="alert" data-test="warning">{{ t('accessTokens.issuedWarning') }}</p>
        <section class="tokens__block">
          <h3 class="tokens__label">{{ t('accessTokens.token') }}</h3>
          <div class="tokens__row">
            <code class="tokens__code" data-test="token-value">{{ issued }}</code>
            <CopyButton :text="issued" :label="t('accessTokens.copyToken')" />
          </div>
        </section>
        <section class="tokens__block">
          <h3 class="tokens__label">{{ t('accessTokens.command') }}</h3>
          <div class="tokens__row">
            <pre class="tokens__code" data-test="command">{{ connectCommand }}</pre>
            <CopyButton :text="connectCommand" :label="t('accessTokens.copyCommand')" />
          </div>
        </section>
        <div class="tokens__actions">
          <AppButton type="button" size="md" data-test="done" @click="issued = null">{{ t('accessTokens.done') }}</AppButton>
        </div>
      </div>
    </AppDialog>

    <AppDialog v-model:open="confirmOpen" :title="t('accessTokens.revokeTitle')" :close-label="t('accessTokens.cancel')" @close-auto-focus="returnFocus">
      <p v-if="pending" data-test="confirm-text">{{ t('accessTokens.revokeConfirm', { name: pending.name }) }}</p>
      <div class="tokens__actions">
        <button type="button" class="tokens__cancel" data-test="revoke-cancel" :disabled="revoking" @click="pending = null">
          {{ t('accessTokens.cancel') }}
        </button>
        <button type="button" class="tokens__confirm" data-test="confirm" :disabled="revoking" @click="confirmRevoke">
          {{ revoking ? t('accessTokens.revoking') : t('accessTokens.revokeAction') }}
        </button>
      </div>
    </AppDialog>

    <AppDialog v-model:open="disconnectOpen" :title="t('accessTokens.disconnectTitle')" :close-label="t('accessTokens.cancel')" @close-auto-focus="returnFocus">
      <p v-if="pendingConnection" data-test="disconnect-text">
        {{ t('accessTokens.disconnectConfirm', { name: pendingConnection.client.name }) }}
      </p>
      <div class="tokens__actions">
        <button type="button" class="tokens__cancel" data-test="disconnect-cancel" :disabled="disconnecting" @click="pendingConnection = null">
          {{ t('accessTokens.cancel') }}
        </button>
        <button type="button" class="tokens__confirm" data-test="disconnect-confirm" :disabled="disconnecting" @click="confirmDisconnect">
          {{ disconnecting ? t('accessTokens.disconnecting') : t('accessTokens.disconnectAction') }}
        </button>
      </div>
    </AppDialog>
  </section>
</template>

<style scoped>
.tokens {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 760px;
  margin: 0 auto;
  padding: 44px 32px 40px;
}

.tokens p {
  margin: 0;
}

.tokens__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tokens__title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.tokens__connections {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 28px;
}

.tokens__subtitle {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}

.tokens__description {
  margin-bottom: 12px;
  color: var(--ink-3);
}

.tokens__empty {
  padding: 40px 16px;
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-panel);
  color: var(--ink-3);
  text-align: center;
}

.tokens__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tokens__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

.tokens__main {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tokens__name {
  overflow-wrap: anywhere;
}

.tokens__expired {
  color: var(--level-error-fg);
  font-size: 13px;
}

.tokens__details {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  font-size: 13px;
}

.tokens__details div {
  display: flex;
  gap: 8px;
}

.tokens__details dt {
  color: var(--ink-3);
}

.tokens__details dd {
  margin: 0;
  color: var(--ink-2);
}

.tokens__revoke,
.tokens__cancel,
.tokens__confirm {
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.tokens__revoke {
  color: var(--level-error-fg);
}

.tokens__confirm {
  border-color: var(--level-error-fg);
  background: var(--level-error-bg);
  color: var(--level-error-fg);
}

.tokens__confirm:disabled,
.tokens__cancel:disabled {
  opacity: 0.6;
  cursor: default;
}

.tokens__revoke:focus-visible,
.tokens__cancel:focus-visible,
.tokens__confirm:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.tokens__form,
.tokens__issued {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.tokens__warning {
  padding: 10px 12px;
  border-radius: var(--radius-control);
  background: var(--level-error-bg);
  color: var(--level-error-fg);
  font-size: 13px;
}

.tokens__block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tokens__label {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.tokens__row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.tokens__code {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.tokens__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

@media (max-width: 600px) {
  .tokens {
    padding: 24px 16px;
  }
}
</style>
