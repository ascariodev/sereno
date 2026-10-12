<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import type { Organization } from '../api/types'
import { useOrganizationStore } from '../stores/organization'
import AppButton from './ui/AppButton.vue'
import AppDialog from './ui/AppDialog.vue'
import AppFormError from './ui/AppFormError.vue'
import AppInput from './ui/AppInput.vue'
import { toast } from './ui/toast'

const NAME_MAX_LENGTH = 255

const emit = defineEmits<{ created: [organization: Organization] }>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const organization = useOrganizationStore()

const nameInput = ref<InstanceType<typeof AppInput> | null>(null)
const name = ref('')
const submitting = ref(false)
const fieldErrors = ref<Record<string, string[]>>({})
const formError = ref<string | null>(null)
let generation = 0
let opener: HTMLElement | null = null

const dialogOpen = computed({
  get: () => open.value,
  set: (value: boolean) => {
    if (!value && submitting.value) return
    open.value = value
  },
})

function reset(): void {
  generation++
  name.value = ''
  submitting.value = false
  fieldErrors.value = {}
  formError.value = null
}

watch(
  open,
  (value) => {
    if (value) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      reset()
      void nextTick(() => nameInput.value?.focus())
    } else {
      generation++
    }
  },
  { flush: 'sync' },
)

onUnmounted(() => {
  generation++
})

function returnFocus(event: Event): void {
  event.preventDefault()
  const target = opener
  opener = null
  if (target?.isConnected) target.focus()
}

function validate(): string[] {
  const trimmed = name.value.trim()
  if (trimmed === '') return [t('orgCreate.nameRequired')]
  if ([...trimmed].length > NAME_MAX_LENGTH) return [t('orgCreate.nameTooLong', { max: NAME_MAX_LENGTH })]
  return []
}

async function submit(): Promise<void> {
  if (submitting.value) return
  formError.value = null
  const local = validate()
  fieldErrors.value = local.length ? { name: local } : {}
  if (local.length) return
  const current = ++generation
  submitting.value = true
  try {
    const created = await organization.create(name.value.trim())
    if (current !== generation) return
    emit('created', created)
    toast.success(t('orgCreate.created', { name: created.name }))
    open.value = false
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 422) {
      fieldErrors.value = error.errors
      if (!error.errors.name?.length) formError.value = error.message
    } else if (error.status === 429) {
      formError.value = t('orgCreate.tooManyAttempts')
    } else if (error.status === 0) {
      formError.value = t('orgCreate.network')
    } else {
      formError.value = t('orgCreate.failed')
    }
  } finally {
    if (current === generation) submitting.value = false
  }
}
</script>

<template>
  <AppDialog
    v-model:open="dialogOpen"
    :title="t('orgCreate.title')"
    :close-label="t('orgCreate.cancel')"
    @close-auto-focus="returnFocus"
  >
    <form class="org-create" novalidate @submit.prevent="submit">
      <AppInput
        id="org-create-name"
        ref="nameInput"
        v-model="name"
        :label="t('orgCreate.nameLabel')"
        :errors="fieldErrors.name"
        error-test="error-name"
        type="text"
        name="name"
        autocomplete="organization"
        required
      />

      <AppFormError v-if="formError" data-test="error-form">{{ formError }}</AppFormError>

      <div class="org-create__actions">
        <AppButton type="button" variant="secondary" size="md" data-test="cancel" :disabled="submitting" @click="dialogOpen = false">
          {{ t('orgCreate.cancel') }}
        </AppButton>
        <AppButton type="submit" size="md" data-test="submit" :disabled="submitting">
          {{ submitting ? t('orgCreate.creating') : t('orgCreate.submit') }}
        </AppButton>
      </div>
    </form>
  </AppDialog>
</template>

<style scoped>
.org-create {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.org-create__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
