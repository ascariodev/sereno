<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { listInvitations, revokeInvitation } from '../api/invitations'
import type { Invitation } from '../api/types'
import InviteDialog from '../components/InviteDialog.vue'
import AppDialog from '../components/ui/AppDialog.vue'
import { toast } from '../components/ui/toast'
import { useOrganizationStore } from '../stores/organization'

const { t, locale } = useI18n()
const organization = useOrganizationStore()
const router = useRouter()

const invitations = ref<Invitation[]>([])
const loading = ref(false)
const failed = ref(false)
const pending = ref<Invitation | null>(null)
const revoking = ref(false)
const inviteOpen = ref(false)
let generation = 0
let controller: AbortController | null = null

const roles = computed(() => organization.active?.roles ?? [])
const isOwner = computed(() => roles.value.includes('owner'))
const canManage = computed(() => isOwner.value || roles.value.includes('admin'))

const confirmOpen = computed({
  get: () => pending.value !== null,
  set: (open: boolean) => {
    if (!open && !revoking.value) pending.value = null
  },
})

function canRevoke(invitation: Invitation): boolean {
  return isOwner.value || invitation.role !== 'owner'
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
}

async function load(): Promise<void> {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  invitations.value = []
  pending.value = null
  inviteOpen.value = false
  failed.value = false
  loading.value = true
  try {
    const result = await listInvitations(controller.signal)
    if (current !== generation) return
    invitations.value = result
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    failed.value = true
  } finally {
    if (current === generation) loading.value = false
  }
}

watch(
  () => [organization.activeId, canManage.value] as const,
  ([, allowed]) => {
    if (allowed) {
      void load()
      return
    }
    generation++
    controller?.abort()
    invitations.value = []
    void router.replace({ name: 'projects' })
  },
  { immediate: true },
)

onUnmounted(() => {
  generation++
  controller?.abort()
})

function onCreated(created: Invitation): void {
  const email = created.email.toLowerCase()
  invitations.value = [created, ...invitations.value.filter((item) => item.email.toLowerCase() !== email)]
}

async function confirmRevoke(): Promise<void> {
  const target = pending.value
  if (!target || revoking.value) return
  const current = generation
  revoking.value = true
  try {
    await revokeInvitation(target.id)
    if (current !== generation) return
    invitations.value = invitations.value.filter((invitation) => invitation.id !== target.id)
    toast.success(t('invitations.revoked', { email: target.email }))
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 404) {
      invitations.value = invitations.value.filter((invitation) => invitation.id !== target.id)
      toast.error(t('invitations.revokeGone'))
    } else if (error.status === 403) {
      toast.error(t('invitations.revokeForbidden'))
    } else {
      toast.error(t('invitations.revokeFailed'))
    }
  } finally {
    revoking.value = false
    if (current === generation) pending.value = null
  }
}
</script>

<template>
  <section v-if="canManage" class="invitations">
    <header class="invitations__header">
      <h1 class="invitations__title">{{ t('invitations.title') }}</h1>
      <button type="button" class="invitations__invite" data-test="invite" @click="inviteOpen = true">
        {{ t('invitations.invite') }}
      </button>
    </header>
    <p v-if="loading" data-test="loading">{{ t('common.loading') }}</p>
    <p v-else-if="failed" role="alert" data-test="load-failed">
      {{ t('invitations.loadFailed') }}
      <button type="button" name="retry" @click="load">{{ t('common.retry') }}</button>
    </p>
    <p v-else-if="invitations.length === 0" class="invitations__empty" data-test="empty">
      {{ t('invitations.empty') }}
    </p>
    <ul v-else class="invitations__list">
      <li v-for="invitation in invitations" :key="invitation.id" class="invitations__item" data-test="invitation">
        <div class="invitations__main">
          <strong class="invitations__email" data-test="email">{{ invitation.email }}</strong>
          <span class="invitations__meta" data-test="role">{{ t(`invite.roles.${invitation.role}`) }}</span>
        </div>
        <dl class="invitations__details">
          <div>
            <dt>{{ t('invitations.invitedBy') }}</dt>
            <dd data-test="inviter">{{ invitation.invited_by?.name ?? t('invitations.unknownInviter') }}</dd>
          </div>
          <div>
            <dt>{{ t('invitations.expires') }}</dt>
            <dd data-test="expires">{{ formatDate(invitation.expires_at) }}</dd>
          </div>
        </dl>
        <button
          v-if="canRevoke(invitation)"
          type="button"
          class="invitations__revoke"
          data-test="revoke"
          :aria-label="`${t('invitations.revoke')} ${invitation.email}`"
          @click="pending = invitation"
        >
          {{ t('invitations.revoke') }}
        </button>
      </li>
    </ul>

    <InviteDialog v-model:open="inviteOpen" :is-owner="isOwner" @created="onCreated" />

    <AppDialog v-model:open="confirmOpen" :title="t('invitations.revokeTitle')" :close-label="t('invitations.cancel')">
      <p v-if="pending" data-test="confirm-text">{{ t('invitations.revokeConfirm', { email: pending.email }) }}</p>
      <div class="invitations__actions">
        <button type="button" class="invitations__cancel" data-test="cancel" :disabled="revoking" @click="pending = null">
          {{ t('invitations.cancel') }}
        </button>
        <button type="button" class="invitations__confirm" data-test="confirm" :disabled="revoking" @click="confirmRevoke">
          {{ revoking ? t('invitations.revoking') : t('invitations.revokeAction') }}
        </button>
      </div>
    </AppDialog>
  </section>
</template>

<style scoped>
.invitations {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 760px;
  margin: 0 auto;
  padding: 44px 32px 40px;
}

.invitations p {
  margin: 0;
}

.invitations__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.invitations__invite {
  min-height: 44px;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  background: var(--ink);
  color: var(--surface);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.invitations__invite:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.invitations__title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.invitations__empty {
  padding: 40px 16px;
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-panel);
  color: var(--ink-3);
  text-align: center;
}

.invitations__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.invitations__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

.invitations__main {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.invitations__email {
  overflow-wrap: anywhere;
}

.invitations__meta {
  color: var(--ink-3);
  font-size: 13px;
}

.invitations__details {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  font-size: 13px;
}

.invitations__details div {
  display: flex;
  gap: 8px;
}

.invitations__details dt {
  color: var(--ink-3);
}

.invitations__details dd {
  margin: 0;
  color: var(--ink-2);
}

.invitations__revoke,
.invitations__cancel,
.invitations__confirm {
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

.invitations__revoke {
  color: var(--level-error-fg);
}

.invitations__confirm {
  border-color: transparent;
  background: var(--ink);
  color: var(--surface);
}

.invitations__confirm:disabled,
.invitations__cancel:disabled {
  opacity: 0.6;
  cursor: default;
}

.invitations__revoke:focus-visible,
.invitations__cancel:focus-visible,
.invitations__confirm:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.invitations__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

@media (max-width: 600px) {
  .invitations {
    padding: 24px 16px;
  }
}
</style>
