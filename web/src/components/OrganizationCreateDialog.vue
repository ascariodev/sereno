<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import type { Organization } from '../api/types'
import { useOrganizationStore } from '../stores/organization'
import AppDialog from './ui/AppDialog.vue'
import { toast } from './ui/toast'

const NAME_MAX_LENGTH = 255

const emit = defineEmits<{ created: [organization: Organization] }>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const organization = useOrganizationStore()

const nameInput = ref<HTMLInputElement | null>(null)
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

const nameDescribedBy = computed(() => {
  const count = fieldErrors.value.name?.length ?? 0
  return count ? Array.from({ length: count }, (_, index) => `org-create-name-error-${index}`).join(' ') : undefined
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
      <div class="org-create__field">
        <label for="org-create-name">{{ t('orgCreate.nameLabel') }}</label>
        <input
          id="org-create-name"
          ref="nameInput"
          v-model="name"
          type="text"
          name="name"
          autocomplete="organization"
          required
          :aria-invalid="nameDescribedBy ? 'true' : undefined"
          :aria-describedby="nameDescribedBy"
        />
        <p
          v-for="(message, index) in fieldErrors.name"
          :id="`org-create-name-error-${index}`"
          :key="`${index}-${message}`"
          class="org-create__error"
          data-test="error-name"
        >
          {{ message }}
        </p>
      </div>

      <p v-if="formError" class="org-create__error" role="alert" data-test="error-form">{{ formError }}</p>

      <div class="org-create__actions">
        <button type="button" class="org-create__cancel" data-test="cancel" :disabled="submitting" @click="dialogOpen = false">
          {{ t('orgCreate.cancel') }}
        </button>
        <button type="submit" class="org-create__submit" data-test="submit" :disabled="submitting">
          {{ submitting ? t('orgCreate.creating') : t('orgCreate.submit') }}
        </button>
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
.org-create__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.org-create__field label {
  font-size: 13px;
  font-weight: 600;
}
.org-create__field input {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}
.org-create__field input:focus-visible,
.org-create__cancel:focus-visible,
.org-create__submit:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.org-create__error {
  margin: 0;
  color: var(--level-error-fg);
  font-size: 13px;
}
.org-create__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.org-create__cancel,
.org-create__submit {
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
.org-create__submit {
  border-color: transparent;
  background: var(--ink);
  color: var(--surface);
}
.org-create__cancel:disabled,
.org-create__submit:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
