<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { createInvitation } from '../api/invitations'
import type { Invitation, InvitationRole } from '../api/types'
import { useOrganizationStore } from '../stores/organization'
import AppDialog from './ui/AppDialog.vue'
import { toast } from './ui/toast'

const props = defineProps<{ isOwner: boolean }>()
const emit = defineEmits<{ created: [invitation: Invitation] }>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const organization = useOrganizationStore()

const emailInput = ref<HTMLInputElement | null>(null)
const email = ref('')
const role = ref<InvitationRole>('member')
const submitting = ref(false)
const fieldErrors = ref<Record<string, string[]>>({})
const formError = ref<string | null>(null)
let generation = 0

const roleOptions = computed<InvitationRole[]>(() =>
  props.isOwner ? ['member', 'admin', 'owner'] : ['member', 'admin'],
)

const dialogOpen = computed({
  get: () => open.value,
  set: (value: boolean) => {
    if (!value && submitting.value) return
    open.value = value
  },
})

function describedBy(field: 'email' | 'role'): string | undefined {
  const count = fieldErrors.value[field]?.length ?? 0
  return count ? Array.from({ length: count }, (_, index) => `invite-${field}-error-${index}`).join(' ') : undefined
}

function reset(): void {
  generation++
  email.value = ''
  role.value = 'member'
  submitting.value = false
  fieldErrors.value = {}
  formError.value = null
}

watch(open, (value) => {
  reset()
  if (value) void nextTick(() => emailInput.value?.focus())
})

watch(
  () => organization.activeId,
  () => {
    reset()
    open.value = false
  },
)

watch(roleOptions, (options) => {
  if (!options.includes(role.value)) role.value = 'member'
})

onUnmounted(() => {
  generation++
})

async function submit(): Promise<void> {
  if (submitting.value) return
  const current = ++generation
  submitting.value = true
  fieldErrors.value = {}
  formError.value = null
  try {
    const invitation = await createInvitation(email.value.trim(), role.value)
    if (current !== generation) return
    emit('created', invitation)
    toast.success(t('inviteDialog.sent', { email: invitation.email }))
    open.value = false
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 422) {
      fieldErrors.value = error.errors
      if (!error.errors.email?.length && !error.errors.role?.length) formError.value = error.message
    } else if (error.status === 403) {
      formError.value = t('inviteDialog.forbidden')
    } else if (error.status === 429) {
      formError.value = t('inviteDialog.tooManyAttempts')
    } else if (error.status === 0) {
      formError.value = t('inviteDialog.network')
    } else {
      formError.value = t('inviteDialog.failed')
    }
  } finally {
    if (current === generation) submitting.value = false
  }
}
</script>

<template>
  <AppDialog v-model:open="dialogOpen" :title="t('inviteDialog.title')" :close-label="t('inviteDialog.cancel')">
    <form class="invite-dialog" novalidate @submit.prevent="submit">
      <div class="invite-dialog__field">
        <label for="invite-email">{{ t('inviteDialog.email') }}</label>
        <input
          id="invite-email"
          ref="emailInput"
          v-model="email"
          type="email"
          name="email"
          autocomplete="off"
          required
          :aria-invalid="describedBy('email') ? 'true' : undefined"
          :aria-describedby="describedBy('email')"
        />
        <p
          v-for="(message, index) in fieldErrors.email"
          :id="`invite-email-error-${index}`"
          :key="`${index}-${message}`"
          class="invite-dialog__error"
          data-test="error-email"
        >
          {{ message }}
        </p>
      </div>

      <div class="invite-dialog__field">
        <label for="invite-role">{{ t('inviteDialog.role') }}</label>
        <select
          id="invite-role"
          v-model="role"
          name="role"
          :aria-invalid="describedBy('role') ? 'true' : undefined"
          :aria-describedby="describedBy('role')"
        >
          <option v-for="option in roleOptions" :key="option" :value="option">{{ t(`invite.roles.${option}`) }}</option>
        </select>
        <p
          v-for="(message, index) in fieldErrors.role"
          :id="`invite-role-error-${index}`"
          :key="`${index}-${message}`"
          class="invite-dialog__error"
          data-test="error-role"
        >
          {{ message }}
        </p>
      </div>

      <p v-if="formError" class="invite-dialog__error" role="alert" data-test="error-form">{{ formError }}</p>

      <div class="invite-dialog__actions">
        <button type="button" class="invite-dialog__cancel" data-test="cancel" :disabled="submitting" @click="dialogOpen = false">
          {{ t('inviteDialog.cancel') }}
        </button>
        <button type="submit" class="invite-dialog__submit" data-test="submit" :disabled="submitting">
          {{ submitting ? t('inviteDialog.sending') : t('inviteDialog.submit') }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>

<style scoped>
.invite-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.invite-dialog__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.invite-dialog__field label {
  font-size: 13px;
  font-weight: 600;
}

.invite-dialog__field input,
.invite-dialog__field select {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}

.invite-dialog__field input:focus-visible,
.invite-dialog__field select:focus-visible,
.invite-dialog__cancel:focus-visible,
.invite-dialog__submit:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.invite-dialog__error {
  margin: 0;
  color: var(--level-error-fg);
  font-size: 13px;
}

.invite-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.invite-dialog__cancel,
.invite-dialog__submit {
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

.invite-dialog__submit {
  border-color: transparent;
  background: var(--ink);
  color: var(--surface);
}

.invite-dialog__cancel:disabled,
.invite-dialog__submit:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
