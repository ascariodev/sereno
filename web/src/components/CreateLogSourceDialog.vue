<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { createLogSource } from '../api/logSources'
import type { LogSourceWithKey } from '../api/types'
import { useOrganizationStore } from '../stores/organization'
import AppButton from './ui/AppButton.vue'
import AppDialog from './ui/AppDialog.vue'
import AppInput from './ui/AppInput.vue'
import { toast } from './ui/toast'

const NAME_MAX_LENGTH = 255

const props = defineProps<{ projectId: number }>()
const emit = defineEmits<{ created: [source: LogSourceWithKey] }>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const organization = useOrganizationStore()

const nameInput = ref<InstanceType<typeof AppInput> | null>(null)
const name = ref('')
const submitting = ref(false)
const fieldErrors = ref<Record<string, string[]>>({})
const formError = ref<string | null>(null)
let generation = 0

const dialogOpen = computed({
  get: () => open.value,
  set: (value: boolean) => {
    if (!value && submitting.value) return
    open.value = value
  },
})

const nameErrors = computed(() => [...(fieldErrors.value.name ?? []), ...(fieldErrors.value.project ?? [])])

function reset(): void {
  generation++
  name.value = ''
  submitting.value = false
  fieldErrors.value = {}
  formError.value = null
}

watch(open, (value) => {
  reset()
  if (value) void nextTick(() => nameInput.value?.focus())
})

watch(
  () => [organization.activeId, props.projectId],
  () => {
    reset()
    open.value = false
  },
)

onUnmounted(() => {
  generation++
})

async function submit(): Promise<void> {
  if (submitting.value) return
  const trimmed = name.value.trim()
  fieldErrors.value = {}
  formError.value = null
  if (trimmed === '') {
    fieldErrors.value = { name: [t('createLogSource.nameRequired')] }
    return
  }
  if ([...trimmed].length > NAME_MAX_LENGTH) {
    fieldErrors.value = { name: [t('createLogSource.nameTooLong', { max: NAME_MAX_LENGTH })] }
    return
  }
  const current = ++generation
  submitting.value = true
  try {
    const source = await createLogSource(props.projectId, trimmed)
    if (current !== generation) {
      toast.error(t('createLogSource.keyLost', { name: source.name }))
      return
    }
    open.value = false
    emit('created', source)
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 422) {
      fieldErrors.value = error.errors
      if (!error.errors.name?.length && !error.errors.project?.length) formError.value = error.message
    } else if (error.status === 403) {
      formError.value = t('createLogSource.forbidden')
    } else if (error.status === 0) {
      formError.value = t('createLogSource.network')
    } else {
      formError.value = t('createLogSource.failed')
    }
  } finally {
    if (current === generation) submitting.value = false
  }
}
</script>

<template>
  <AppDialog v-model:open="dialogOpen" :title="t('createLogSource.title')" :close-label="t('createLogSource.cancel')">
    <form class="create-source" novalidate @submit.prevent="submit">
      <AppInput
        id="log-source-name"
        ref="nameInput"
        v-model="name"
        :label="t('createLogSource.name')"
        :errors="nameErrors"
        error-test="error-name"
        type="text"
        name="name"
        autocomplete="off"
        required
      >
        <template #hint>{{ t('createLogSource.nameHint') }}</template>
      </AppInput>

      <p v-if="formError" class="create-source__error" role="alert" data-test="error-form">{{ formError }}</p>

      <div class="create-source__actions">
        <AppButton type="button" variant="secondary" size="md" data-test="cancel" :disabled="submitting" @click="dialogOpen = false">
          {{ t('createLogSource.cancel') }}
        </AppButton>
        <AppButton type="submit" size="md" data-test="submit" :disabled="submitting">
          {{ submitting ? t('createLogSource.creating') : t('createLogSource.submit') }}
        </AppButton>
      </div>
    </form>
  </AppDialog>
</template>

<style scoped>
.create-source {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.create-source__error {
  margin: 0;
  color: var(--level-error-fg);
  font-size: 13px;
}

.create-source__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
