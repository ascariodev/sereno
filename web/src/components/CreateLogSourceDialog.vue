<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { createLogSource } from '../api/logSources'
import type { LogSourceWithKey } from '../api/types'
import { useOrganizationStore } from '../stores/organization'
import AppDialog from './ui/AppDialog.vue'

const NAME_MAX_LENGTH = 255

const props = defineProps<{ projectId: number }>()
const emit = defineEmits<{ created: [source: LogSourceWithKey] }>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const organization = useOrganizationStore()

const nameInput = ref<HTMLInputElement | null>(null)
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
const nameDescribedBy = computed(() =>
  nameErrors.value.length ? nameErrors.value.map((_, index) => `log-source-name-error-${index}`).join(' ') : undefined,
)

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
    if (current !== generation) return
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
      <div class="create-source__field">
        <label for="log-source-name">{{ t('createLogSource.name') }}</label>
        <input
          id="log-source-name"
          ref="nameInput"
          v-model="name"
          type="text"
          name="name"
          autocomplete="off"
          required
          :aria-invalid="nameDescribedBy ? 'true' : undefined"
          :aria-describedby="nameDescribedBy"
        />
        <p class="create-source__hint">{{ t('createLogSource.nameHint') }}</p>
        <p
          v-for="(message, index) in nameErrors"
          :id="`log-source-name-error-${index}`"
          :key="`${index}-${message}`"
          class="create-source__error"
          data-test="error-name"
        >
          {{ message }}
        </p>
      </div>

      <p v-if="formError" class="create-source__error" role="alert" data-test="error-form">{{ formError }}</p>

      <div class="create-source__actions">
        <button type="button" class="create-source__cancel" data-test="cancel" :disabled="submitting" @click="dialogOpen = false">
          {{ t('createLogSource.cancel') }}
        </button>
        <button type="submit" class="create-source__submit" data-test="submit" :disabled="submitting">
          {{ submitting ? t('createLogSource.creating') : t('createLogSource.submit') }}
        </button>
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

.create-source__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.create-source__field label {
  font-size: 13px;
  font-weight: 600;
}

.create-source__field input {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}

.create-source__field input:focus-visible,
.create-source__cancel:focus-visible,
.create-source__submit:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.create-source__hint {
  margin: 0;
  color: var(--ink-3);
  font-size: 13px;
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

.create-source__cancel,
.create-source__submit {
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

.create-source__submit {
  border-color: transparent;
  background: var(--ink);
  color: var(--surface);
}

.create-source__cancel:disabled,
.create-source__submit:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
