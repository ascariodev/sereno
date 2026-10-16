<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { createLogSource } from '../api/logSources'
import type { LogSourceKind, LogSourceWithKey } from '../api/types'
import { useOrganizationStore } from '../stores/organization'
import AppButton from './ui/AppButton.vue'
import AppDialog from './ui/AppDialog.vue'
import AppFormError from './ui/AppFormError.vue'
import AppInput from './ui/AppInput.vue'
import AppSegmented from './ui/AppSegmented.vue'
import { toast } from './ui/toast'

const NAME_MAX_LENGTH = 255
const ORIGIN_MAX_LENGTH = 255
const MAX_ORIGINS = 20
const ORIGIN_PATTERN =
  /^(?:https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|http:\/\/(?:localhost|127\.0\.0\.1))(?::([1-9][0-9]{0,4}))?$/

function normalizeOrigin(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(https:\/\/[^/]+):443$/, '$1')
    .replace(/^(http:\/\/[^/]+):80$/, '$1')
}

function isValidOrigin(origin: string): boolean {
  if (origin.length > ORIGIN_MAX_LENGTH) return false
  const match = ORIGIN_PATTERN.exec(origin)
  return match !== null && (match[1] === undefined || Number(match[1]) <= 65535)
}

const props = defineProps<{ projectId: number }>()
const emit = defineEmits<{ created: [source: LogSourceWithKey] }>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const organization = useOrganizationStore()

const nameInput = ref<InstanceType<typeof AppInput> | null>(null)
const name = ref('')
const kind = ref<LogSourceKind>('server')
const origins = ref<string[]>([])
const originDraft = ref('')
const draftError = ref<string | null>(null)
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

const kindOptions = computed(() => [
  { value: 'server', label: t('createLogSource.kindServer') },
  { value: 'browser', label: t('createLogSource.kindBrowser') },
])

const originsListErrors = computed(() => fieldErrors.value.allowed_origins ?? [])

function originErrors(index: number): string[] {
  return fieldErrors.value[`allowed_origins.${index}`] ?? []
}

const hasVisibleErrors = computed(() =>
  Object.keys(fieldErrors.value).some((key) => key === 'name' || key === 'project' || key.startsWith('allowed_origins')),
)

function setKind(value: string): void {
  kind.value = value === 'browser' ? 'browser' : 'server'
  fieldErrors.value = {}
  formError.value = null
  draftError.value = null
}

function addOrigin(): boolean {
  const origin = normalizeOrigin(originDraft.value)
  draftError.value = null
  if (origin === '') return true
  if (!isValidOrigin(origin)) {
    draftError.value = t('createLogSource.originInvalid')
    return false
  }
  if (!origins.value.includes(origin)) {
    if (origins.value.length >= MAX_ORIGINS) {
      draftError.value = t('createLogSource.originsTooMany', { max: MAX_ORIGINS })
      return false
    }
    origins.value = [...origins.value, origin]
    fieldErrors.value = {}
  }
  originDraft.value = ''
  return true
}

function removeOrigin(index: number): void {
  origins.value = origins.value.filter((_, position) => position !== index)
  fieldErrors.value = {}
}

function reset(): void {
  generation++
  name.value = ''
  kind.value = 'server'
  origins.value = []
  originDraft.value = ''
  draftError.value = null
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
  if (kind.value === 'browser') {
    if (!addOrigin()) return
    if (origins.value.length === 0) {
      fieldErrors.value = { allowed_origins: [t('createLogSource.originsRequired')] }
      return
    }
  }
  const current = ++generation
  submitting.value = true
  try {
    const source = await createLogSource(
      props.projectId,
      kind.value === 'browser' ? { name: trimmed, kind: 'browser', allowed_origins: origins.value } : { name: trimmed },
    )
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
      if (!hasVisibleErrors.value) formError.value = error.message
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

      <div class="create-source__kind">
        <span class="create-source__label">{{ t('createLogSource.kind') }}</span>
        <AppSegmented :model-value="kind" :options="kindOptions" :label="t('createLogSource.kind')" @update:model-value="setKind" />
        <p class="create-source__hint">
          {{ kind === 'browser' ? t('createLogSource.kindBrowserHint') : t('createLogSource.kindServerHint') }}
        </p>
      </div>

      <div v-if="kind === 'browser'" class="create-source__origins" data-test="origins">
        <AppInput
          id="log-source-origin"
          v-model="originDraft"
          :label="t('createLogSource.origins')"
          :errors="draftError ? [draftError] : []"
          error-test="error-origin-draft"
          type="text"
          name="origin"
          autocomplete="off"
          placeholder="https://example.com"
          @keydown.enter.prevent="addOrigin"
        >
          <template #hint>{{ t('createLogSource.originsHint') }}</template>
        </AppInput>
        <AppButton type="button" variant="secondary" size="md" data-test="add-origin" @click="addOrigin">
          {{ t('createLogSource.addOrigin') }}
        </AppButton>
        <ul v-if="origins.length" class="create-source__origin-list">
          <li v-for="(origin, index) in origins" :key="origin" data-test="origin">
            <div class="create-source__origin-row">
              <code>{{ origin }}</code>
              <AppButton
                type="button"
                variant="secondary"
                size="md"
                data-test="remove-origin"
                :aria-label="t('createLogSource.removeOrigin', { origin })"
                @click="removeOrigin(index)"
              >
                {{ t('createLogSource.remove') }}
              </AppButton>
            </div>
            <AppFormError v-for="message in originErrors(index)" :key="message" :data-test="`error-origin-${index}`">
              {{ message }}
            </AppFormError>
          </li>
        </ul>
        <AppFormError v-for="message in originsListErrors" :key="message" data-test="error-origins">{{ message }}</AppFormError>
      </div>

      <AppFormError v-if="formError" data-test="error-form">{{ formError }}</AppFormError>

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

.create-source__kind,
.create-source__origins {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.create-source__label {
  font-size: 13px;
  font-weight: 600;
}

.create-source__hint {
  margin: 0;
  color: var(--ink-3);
  font-size: 13px;
}

.create-source__origins :deep(.app-input) {
  align-self: stretch;
}

.create-source__origin-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-self: stretch;
  margin: 0;
  padding: 0;
  list-style: none;
}

.create-source__origin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.create-source__origin-row code {
  overflow-wrap: anywhere;
}

.create-source__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
