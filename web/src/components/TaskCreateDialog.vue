<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import type { Task, TaskStatus } from '../api/types'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useOrganizationStore } from '../stores/organization'
import { useTasksStore } from '../stores/tasks'
import { TASK_DESCRIPTION_MAX_LENGTH, TASK_TITLE_MAX_LENGTH } from './taskLimits'
import AppDialog from './ui/AppDialog.vue'

const props = withDefaults(
  defineProps<{
    projectId: number
    /** Column where the task is created. */
    status?: TaskStatus
    /** Title the form opens with (a log group's title in phases 24 and 25). */
    initialTitle?: string
    /** Log group the task comes from. */
    logGroupId?: number | null
  }>(),
  { status: 'todo', initialTitle: '', logGroupId: null },
)
const emit = defineEmits<{ created: [task: Task] }>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const organization = useOrganizationStore()
const directory = useMemberDirectoryStore()
const tasks = useTasksStore()

const titleInput = ref<HTMLInputElement | null>(null)
const title = ref('')
const description = ref('')
const assigneeId = ref<number | null>(null)
const submitting = ref(false)
const fieldErrors = ref<Record<string, string[]>>({})
const formError = ref<string | null>(null)
let generation = 0
let opener: HTMLElement | null = null

const FIELDS = ['title', 'description', 'assignee_id'] as const
type Field = (typeof FIELDS)[number]

const dialogOpen = computed({
  get: () => open.value,
  set: (value: boolean) => {
    if (!value && submitting.value) return
    open.value = value
  },
})

const charCount = (value: string) => [...value].length

function describedBy(field: Field): string | undefined {
  const count = fieldErrors.value[field]?.length ?? 0
  return count ? Array.from({ length: count }, (_, index) => `task-create-${field}-error-${index}`).join(' ') : undefined
}

function reset(): void {
  generation++
  title.value = props.initialTitle
  description.value = ''
  assigneeId.value = null
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
      void directory.ensureLoaded()
      void nextTick(() => titleInput.value?.focus())
    } else {
      generation++
    }
  },
  { flush: 'sync' },
)

watch(
  () => organization.activeId,
  () => {
    reset()
    open.value = false
  },
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
  const trimmed = title.value.trim()
  if (trimmed === '') errors.title = [t('taskCreate.titleRequired')]
  else if (charCount(trimmed) > TASK_TITLE_MAX_LENGTH) errors.title = [t('taskCreate.titleTooLong', { max: TASK_TITLE_MAX_LENGTH })]
  if (charCount(description.value.trim()) > TASK_DESCRIPTION_MAX_LENGTH) {
    errors.description = [t('taskCreate.descriptionTooLong', { max: TASK_DESCRIPTION_MAX_LENGTH })]
  }
  return errors
}

async function submit(): Promise<void> {
  if (submitting.value) return
  formError.value = null
  const local = validate()
  fieldErrors.value = local
  if (Object.keys(local).length > 0) return
  const current = ++generation
  submitting.value = true
  try {
    const task = await tasks.create(props.projectId, {
      title: title.value.trim(),
      description: description.value.trim() === '' ? null : description.value.trim(),
      status: props.status,
      assigneeId: assigneeId.value,
      logGroupId: props.logGroupId,
    })
    if (current !== generation) return
    emit('created', task)
    open.value = false
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 422) {
      fieldErrors.value = error.errors
      if (!FIELDS.some((field) => error.errors[field]?.length)) formError.value = error.message
    } else if (error.status === 429) {
      formError.value = t('taskCreate.tooManyAttempts')
    } else if (error.status === 0) {
      formError.value = t('taskCreate.network')
    } else {
      formError.value = t('taskCreate.failed')
    }
  } finally {
    if (current === generation) submitting.value = false
  }
}
</script>

<template>
  <AppDialog
    v-model:open="dialogOpen"
    :title="t('taskCreate.title')"
    :close-label="t('taskCreate.cancel')"
    @close-auto-focus="returnFocus"
  >
    <form class="task-create" novalidate @submit.prevent="submit">
      <div class="task-create__field">
        <label for="task-create-title">{{ t('taskCreate.titleLabel') }}</label>
        <input
          id="task-create-title"
          ref="titleInput"
          v-model="title"
          type="text"
          name="title"
          autocomplete="off"
          required
          :aria-invalid="describedBy('title') ? 'true' : undefined"
          :aria-describedby="describedBy('title')"
        />
        <p
          v-for="(message, index) in fieldErrors.title"
          :id="`task-create-title-error-${index}`"
          :key="`${index}-${message}`"
          class="task-create__error"
          data-test="error-title"
        >
          {{ message }}
        </p>
      </div>

      <div class="task-create__field">
        <label for="task-create-description">{{ t('taskCreate.descriptionLabel') }}</label>
        <textarea
          id="task-create-description"
          v-model="description"
          name="description"
          rows="4"
          :aria-invalid="describedBy('description') ? 'true' : undefined"
          :aria-describedby="describedBy('description')"
        ></textarea>
        <p
          v-for="(message, index) in fieldErrors.description"
          :id="`task-create-description-error-${index}`"
          :key="`${index}-${message}`"
          class="task-create__error"
          data-test="error-description"
        >
          {{ message }}
        </p>
      </div>

      <div class="task-create__field">
        <label for="task-create-assignee">{{ t('taskCreate.assigneeLabel') }}</label>
        <select
          id="task-create-assignee"
          v-model="assigneeId"
          name="assignee"
          :aria-invalid="describedBy('assignee_id') ? 'true' : undefined"
          :aria-describedby="describedBy('assignee_id')"
        >
          <option :value="null">{{ t('plan.unassigned') }}</option>
          <option v-for="member in directory.members" :key="member.id" :value="member.id">{{ member.name }}</option>
        </select>
        <p
          v-for="(message, index) in fieldErrors.assignee_id"
          :id="`task-create-assignee_id-error-${index}`"
          :key="`${index}-${message}`"
          class="task-create__error"
          data-test="error-assignee"
        >
          {{ message }}
        </p>
      </div>

      <p v-if="formError" class="task-create__error" role="alert" data-test="error-form">{{ formError }}</p>

      <div class="task-create__actions">
        <button type="button" class="task-create__cancel" data-test="cancel" :disabled="submitting" @click="dialogOpen = false">
          {{ t('taskCreate.cancel') }}
        </button>
        <button type="submit" class="task-create__submit" data-test="submit" :disabled="submitting">
          {{ submitting ? t('taskCreate.creating') : t('taskCreate.submit') }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>

<style scoped>
.task-create {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.task-create__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.task-create__field label {
  font-size: 13px;
  font-weight: 600;
}
.task-create__field input,
.task-create__field select,
.task-create__field textarea {
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}
.task-create__field input,
.task-create__field select {
  min-height: 44px;
}
.task-create__field textarea {
  padding: 10px 12px;
  resize: vertical;
}
.task-create__field input:focus-visible,
.task-create__field select:focus-visible,
.task-create__field textarea:focus-visible,
.task-create__cancel:focus-visible,
.task-create__submit:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.task-create__error {
  margin: 0;
  color: var(--level-error-fg);
  font-size: 13px;
}
.task-create__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.task-create__cancel,
.task-create__submit {
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
.task-create__submit {
  border-color: transparent;
  background: var(--ink);
  color: var(--surface);
}
.task-create__cancel:disabled,
.task-create__submit:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
