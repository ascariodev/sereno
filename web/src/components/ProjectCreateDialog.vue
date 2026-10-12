<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import type { Project } from '../api/types'
import { useProjectsStore } from '../stores/projects'
import AppButton from './ui/AppButton.vue'
import AppDialog from './ui/AppDialog.vue'
import AppInput from './ui/AppInput.vue'
import { toast } from './ui/toast'

const NAME_MAX_LENGTH = 255
const DESCRIPTION_MAX_LENGTH = 5000
const KEY_MAX_LENGTH = 10
const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/

type Field = 'name' | 'key' | 'description'
const FIELDS: Field[] = ['name', 'key', 'description']

const emit = defineEmits<{ created: [project: Project] }>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const router = useRouter()
const projects = useProjectsStore()

const nameInput = ref<InstanceType<typeof AppInput> | null>(null)
const name = ref('')
const key = ref('')
const description = ref('')
const keyEdited = ref(false)
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

function suggestKey(source: string): string {
  const letters = source
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^[0-9]+/, '')
  return letters.slice(0, KEY_MAX_LENGTH)
}

function onNameInput(value: string): void {
  name.value = value
  if (!keyEdited.value) key.value = suggestKey(value)
}

function onKeyInput(value: string): void {
  key.value = value.toUpperCase()
  keyEdited.value = key.value !== ''
  if (!keyEdited.value) key.value = suggestKey(name.value)
}

function reset(): void {
  generation++
  name.value = ''
  key.value = ''
  description.value = ''
  keyEdited.value = false
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

function validate(): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  const trimmedName = name.value.trim()
  if (trimmedName === '') errors.name = [t('projCreate.nameRequired')]
  else if ([...trimmedName].length > NAME_MAX_LENGTH) errors.name = [t('projCreate.nameTooLong', { max: NAME_MAX_LENGTH })]
  if (!KEY_PATTERN.test(key.value.trim().toUpperCase())) errors.key = [t('projCreate.keyInvalid')]
  if ([...description.value].length > DESCRIPTION_MAX_LENGTH) {
    errors.description = [t('projCreate.descriptionTooLong', { max: DESCRIPTION_MAX_LENGTH })]
  }
  return errors
}

async function submit(): Promise<void> {
  if (submitting.value) return
  formError.value = null
  fieldErrors.value = validate()
  if (Object.keys(fieldErrors.value).length) return
  const current = ++generation
  submitting.value = true
  try {
    const trimmedDescription = description.value.trim()
    const created = await projects.create({
      name: name.value.trim(),
      key: key.value.trim().toUpperCase(),
      description: trimmedDescription === '' ? null : trimmedDescription,
    })
    if (current !== generation) return
    emit('created', created)
    toast.success(t('projCreate.created', { name: created.name }))
    const channelId = projects.channelByProject[created.id]
    open.value = false
    await router.push(channelId === undefined ? { name: 'projects' } : { name: 'channel', params: { id: channelId } })
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 422) {
      fieldErrors.value = error.errors
      if (!FIELDS.some((field) => error.errors[field]?.length)) formError.value = error.message
    } else if (error.status === 403) {
      formError.value = t('projCreate.forbidden')
    } else if (error.status === 429) {
      formError.value = t('projCreate.tooManyAttempts')
    } else if (error.status === 0) {
      formError.value = t('projCreate.network')
    } else {
      formError.value = t('projCreate.failed')
    }
  } finally {
    if (current === generation) submitting.value = false
  }
}
</script>

<template>
  <AppDialog
    v-model:open="dialogOpen"
    :title="t('projCreate.title')"
    :close-label="t('projCreate.cancel')"
    @close-auto-focus="returnFocus"
  >
    <form class="proj-create" novalidate @submit.prevent="submit">
      <AppInput
        id="proj-create-name"
        ref="nameInput"
        :model-value="name"
        :label="t('projCreate.nameLabel')"
        :errors="fieldErrors.name"
        error-test="error-name"
        type="text"
        name="name"
        autocomplete="off"
        required
        @update:model-value="onNameInput"
      />

      <AppInput
        id="proj-create-key"
        :model-value="key"
        :label="t('projCreate.keyLabel')"
        :errors="fieldErrors.key"
        error-test="error-key"
        type="text"
        name="key"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        :maxlength="KEY_MAX_LENGTH"
        required
        @update:model-value="onKeyInput"
      />

      <AppInput
        id="proj-create-description"
        v-model="description"
        :label="t('projCreate.descriptionLabel')"
        :errors="fieldErrors.description"
        error-test="error-description"
        name="description"
        multiline
        :rows="3"
      />

      <p v-if="formError" class="proj-create__error" role="alert" data-test="error-form">{{ formError }}</p>

      <div class="proj-create__actions">
        <AppButton type="button" variant="secondary" size="md" data-test="cancel" :disabled="submitting" @click="dialogOpen = false">
          {{ t('projCreate.cancel') }}
        </AppButton>
        <AppButton type="submit" size="md" data-test="submit" :disabled="submitting">
          {{ submitting ? t('projCreate.creating') : t('projCreate.submit') }}
        </AppButton>
      </div>
    </form>
  </AppDialog>
</template>

<style scoped>
.proj-create {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.proj-create__error {
  margin: 0;
  color: var(--level-error-fg);
  font-size: 13px;
}
.proj-create__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
