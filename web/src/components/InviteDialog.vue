<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { createInvitation } from '../api/invitations'
import type { Invitation, InvitationRole } from '../api/types'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'
import AppButton from './ui/AppButton.vue'
import AppDialog from './ui/AppDialog.vue'
import AppInput from './ui/AppInput.vue'
import AppSelect from './ui/AppSelect.vue'
import { toast } from './ui/toast'

const props = defineProps<{ isOwner: boolean }>()
const emit = defineEmits<{ created: [invitation: Invitation] }>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const organization = useOrganizationStore()
const projectsStore = useProjectsStore()

const emailInput = ref<InstanceType<typeof AppInput> | null>(null)
const email = ref('')
const role = ref<InvitationRole>('member')
const projectIds = ref<number[]>([])
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

const projectErrors = computed(() =>
  Object.entries(fieldErrors.value)
    .filter(([key]) => key === 'project_ids' || key.startsWith('project_ids.'))
    .flatMap(([, messages]) => messages),
)

const projectErrorIds = computed(() =>
  projectErrors.value.map((_, index) => `invite-project_ids-error-${index}`).join(' '),
)

function reset(): void {
  generation++
  email.value = ''
  role.value = 'member'
  projectIds.value = []
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

function setRole(value: string): void {
  role.value = value as InvitationRole
}

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
    const invitation = await createInvitation(
      email.value.trim(),
      role.value,
      projectsStore.projects.map((project) => project.id).filter((id) => projectIds.value.includes(id)),
    )
    if (current !== generation) return
    emit('created', invitation)
    toast.success(t('inviteDialog.sent', { email: invitation.email }))
    open.value = false
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 422) {
      fieldErrors.value = error.errors
      if (!error.errors.email?.length && !error.errors.role?.length && projectErrors.value.length === 0) formError.value = error.message
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
      <AppInput
        id="invite-email"
        ref="emailInput"
        v-model="email"
        :label="t('inviteDialog.email')"
        :errors="fieldErrors.email"
        error-test="error-email"
        type="email"
        name="email"
        autocomplete="off"
        required
      />

      <AppSelect
        id="invite-role"
        :model-value="role"
        :label="t('inviteDialog.role')"
        :errors="fieldErrors.role"
        error-test="error-role"
        name="role"
        @update:model-value="setRole"
      >
        <option v-for="option in roleOptions" :key="option" :value="option">{{ t(`invite.roles.${option}`) }}</option>
      </AppSelect>

      <p
        v-if="role === 'member' && projectsStore.failed"
        class="invite-dialog__error"
        role="alert"
        data-test="projects-failed"
      >
        {{ t('projects.loadFailed') }}
        <AppButton
          type="button"
          variant="secondary"
          size="md"
          data-test="projects-retry"
          :disabled="projectsStore.loading"
          @click="projectsStore.refresh()"
        >
          {{ t('common.retry') }}
        </AppButton>
      </p>

      <fieldset
        v-if="role === 'member' && projectsStore.projects.length > 0"
        class="invite-dialog__projects"
        data-test="projects"
        :aria-invalid="projectErrors.length ? 'true' : undefined"
        :aria-describedby="projectErrors.length ? projectErrorIds : undefined"
      >
        <legend>{{ t('inviteDialog.projects') }}</legend>
        <p class="invite-dialog__hint">{{ t('inviteDialog.projectsHint') }}</p>
        <label v-for="project in projectsStore.projects" :key="project.id" class="invite-dialog__project">
          <input
            v-model="projectIds"
            type="checkbox"
            name="project_ids"
            :value="project.id"
            :aria-invalid="projectErrors.length ? 'true' : undefined"
          />
          <span>{{ project.name }}</span>
          <span class="invite-dialog__key">{{ project.key }}</span>
        </label>
        <p
          v-for="(message, index) in projectErrors"
          :id="`invite-project_ids-error-${index}`"
          :key="`${index}-${message}`"
          class="invite-dialog__error"
          data-test="error-projects"
        >
          {{ message }}
        </p>
      </fieldset>

      <p v-if="formError" class="invite-dialog__error" role="alert" data-test="error-form">{{ formError }}</p>

      <div class="invite-dialog__actions">
        <AppButton type="button" variant="secondary" size="md" data-test="cancel" :disabled="submitting" @click="dialogOpen = false">
          {{ t('inviteDialog.cancel') }}
        </AppButton>
        <AppButton type="submit" size="md" data-test="submit" :disabled="submitting">
          {{ submitting ? t('inviteDialog.sending') : t('inviteDialog.submit') }}
        </AppButton>
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

.invite-dialog__projects {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.invite-dialog__projects legend {
  padding: 0;
  font-size: 13px;
  font-weight: 600;
}

.invite-dialog__hint {
  margin: 0;
  color: var(--ink-3);
  font-size: 13px;
}

.invite-dialog__project {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}

.invite-dialog__project input {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
}

.invite-dialog__key {
  color: var(--ink-3);
  font-size: 12px;
}

.invite-dialog__project:focus-within {
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
</style>
