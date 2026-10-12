<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Trash2, X } from '@lucide/vue'
import { ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useOrganizationStore } from '../stores/organization'
import { useTasksStore } from '../stores/tasks'
import { charCount, TASK_DESCRIPTION_MAX_LENGTH, TASK_TITLE_MAX_LENGTH } from './taskLimits'
import MarkdownContent from './MarkdownContent.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import { toggleTaskItem } from '../markdown/toggleTaskItem'
import AppDialog from './ui/AppDialog.vue'
import LevelPill from './ui/LevelPill.vue'
import ProjectKey from './ui/ProjectKey.vue'
import TaskMoveMenu from './TaskMoveMenu.vue'
import { toast } from './ui/toast'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ projectId: number; taskId: number; readOnly?: boolean }>()
const emit = defineEmits<{ close: [replace?: boolean] }>()

const { t } = useI18n()
const organization = useOrganizationStore()
const auth = useAuthStore()
const directory = useMemberDirectoryStore()
const tasks = useTasksStore()

const Plain = Object.assign((_: unknown, { slots }: { slots: { default?: () => unknown } }) => slots.default?.(), {
  inheritAttrs: false,
})

const task = computed(() => tasks.find(props.taskId))
const title = ref('')
const description = ref('')
const assigneeId = ref<number | null>(null)
const submitting = ref(false)
const fieldErrors = ref<Record<string, string[]>>({})
const formError = ref<string | null>(null)
const confirmOpen = ref(false)
const deleting = ref(false)
let generation = 0
let closed = false
let notFoundHandled = false
let snapshot = { title: '', description: '', assigneeId: null as number | null }

const FIELDS = ['title', 'description', 'assignee_id'] as const
type Field = (typeof FIELDS)[number]

const editingDescription = ref(false)
const showDescriptionEditor = computed(() => !props.readOnly && (editingDescription.value || !!fieldErrors.value.description?.length))

let returnFocusToEdit = false

function closeDescriptionEditor(): void {
  if (showDescriptionEditor.value) returnFocusToEdit = true
  editingDescription.value = false
}

function cancelDescription(): void {
  description.value = snapshot.description
  fieldErrors.value = { ...fieldErrors.value, description: [] }
  closeDescriptionEditor()
}

watch(showDescriptionEditor, async (visible) => {
  const focusEdit = !visible && returnFocusToEdit
  returnFocusToEdit = false
  if (!visible && !focusEdit) return
  await nextTick()
  document.getElementById(visible ? 'task-aside-description' : 'task-aside-description-edit')?.focus()
})
const dirty = computed(
  () => title.value !== snapshot.title || description.value !== snapshot.description || assigneeId.value !== snapshot.assigneeId,
)
const memberOptions = computed(() => {
  const members = directory.membersOf(props.projectId).map((member) => ({ id: member.id, name: member.name }))
  const current = task.value?.assignee
  if (current && !members.some((member) => member.id === current.id)) members.push({ id: current.id, name: current.name })
  return members
})

const canDelete = computed(
  () =>
    !props.readOnly &&
    !!task.value &&
    (task.value.created_by === auth.user?.id || organization.isOwner || organization.isAdmin),
)

function describedBy(field: Field): string | undefined {
  const count = fieldErrors.value[field]?.length ?? 0
  return count ? Array.from({ length: count }, (_, index) => `task-aside-${field}-error-${index}`).join(' ') : undefined
}

function fill(): void {
  const current = task.value
  snapshot = {
    title: current?.title ?? '',
    description: current?.description ?? '',
    assigneeId: current?.assignee?.id ?? null,
  }
  title.value = snapshot.title
  description.value = snapshot.description
  assigneeId.value = snapshot.assigneeId
}

function resetForm(): void {
  generation++
  fill()
  submitting.value = false
  deleting.value = false
  confirmOpen.value = false
  fieldErrors.value = {}
  formError.value = null
  editingDescription.value = false
}

fill()
watch(() => props.projectId, (id) => void directory.ensureLoaded(id), { immediate: true })

watch(
  () => props.taskId,
  () => {
    closed = false
    notFoundHandled = false
    resetForm()
  },
)

// A live edit refreshes the form only when the user has not touched it.
watch(
  () => task.value?.updated_at,
  () => {
    if (task.value && !dirty.value && !submitting.value) fill()
  },
)

function notFound(): void {
  if (notFoundHandled) return
  notFoundHandled = true
  closed = true
  toast.error(t('taskAside.notFound'))
  emit('close', true)
}

let lookedUp = false

watch(
  task,
  (current) => {
    if (current || closed) return
    if (!lookedUp) {
      lookedUp = true
      void tasks.ensure(props.projectId, props.taskId).then((found) => {
        if (!found && !task.value && !closed) notFound()
      })
      return
    }
    notFound()
  },
  { immediate: true },
)

watch(
  () => organization.activeId,
  () => emit('close', true),
)

const narrowQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 767px)') : null
const narrow = ref(narrowQuery?.matches ?? false)
function followViewport(event: MediaQueryListEvent): void {
  narrow.value = event.matches
}
narrowQuery?.addEventListener('change', followViewport)

const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
const panel = ref<HTMLElement | null>(null)

onMounted(() => {
  if (!narrow.value) void nextTick(() => panel.value?.focus({ preventScroll: true }))
})
onBeforeUnmount(() => {
  generation++
  narrowQuery?.removeEventListener('change', followViewport)
  if (!narrow.value && opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true })
})

function onOpenChange(open: boolean): void {
  if (!open) emit('close')
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
  if (submitting.value || props.readOnly || !task.value) return
  formError.value = null
  const local = validate()
  fieldErrors.value = local
  if (Object.keys(local).length > 0) return
  const current = generation
  submitting.value = true
  try {
    const saved = await tasks.update(props.projectId, props.taskId, {
      title: title.value.trim(),
      description: description.value.trim() === '' ? null : description.value.trim(),
      assigneeId: assigneeId.value,
    })
    if (current !== generation) return
    snapshot = { title: saved.title, description: saved.description ?? '', assigneeId: saved.assignee?.id ?? null }
    title.value = snapshot.title
    description.value = snapshot.description
    assigneeId.value = snapshot.assigneeId
    closeDescriptionEditor()
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 422) {
      fieldErrors.value = error.errors
      if (!FIELDS.some((field) => error.errors[field]?.length)) formError.value = error.message
    } else if (error.status === 404) {
      notFound()
    } else if (error.status === 429) {
      formError.value = t('taskCreate.tooManyAttempts')
    } else if (error.status === 0) {
      formError.value = t('taskCreate.network')
    } else {
      formError.value = t('taskAside.failed')
    }
  } finally {
    if (current === generation) submitting.value = false
  }
}

async function toggleTask(lineIndex: number): Promise<void> {
  if (submitting.value || props.readOnly || !task.value || showDescriptionEditor.value) return
  const next = toggleTaskItem(snapshot.description, lineIndex)
  if (next === snapshot.description) return
  formError.value = null
  const current = generation
  submitting.value = true
  try {
    const saved = await tasks.update(props.projectId, props.taskId, {
      title: snapshot.title,
      description: next,
      assigneeId: snapshot.assigneeId,
    })
    if (current !== generation) return
    snapshot = { title: saved.title, description: saved.description ?? '', assigneeId: saved.assignee?.id ?? null }
    if (!showDescriptionEditor.value) description.value = snapshot.description
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 404) {
      notFound()
    } else if (error.status === 422) toast.error(error.message)
    else if (error.status === 429) toast.error(t('taskCreate.tooManyAttempts'))
    else if (error.status === 0) toast.error(t('taskCreate.network'))
    else toast.error(t('taskAside.failed'))
  } finally {
    if (current === generation) submitting.value = false
  }
}

async function confirmDelete(): Promise<void> {
  if (deleting.value || !canDelete.value) return
  const current = generation
  deleting.value = true
  closed = true
  try {
    await tasks.destroy(props.projectId, props.taskId)
    if (current !== generation) return
    confirmOpen.value = false
    emit('close', true)
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    confirmOpen.value = false
    if (error.status === 404) {
      notFound()
      return
    }
    if (notFoundHandled) return
    closed = false
    if (error.status === 403) toast.error(t('taskAside.deleteForbidden'))
    else if (error.status === 422) toast.error(error.message)
    else if (error.status === 0) toast.error(t('taskCreate.network'))
    else toast.error(t('taskAside.deleteFailed'))
  } finally {
    if (current === generation) deleting.value = false
  }
}
</script>

<template>
  <component
    :is="narrow ? AppDialog : Plain"
    v-if="task"
    v-bind="narrow ? { open: true, variant: 'sheet-bottom', title: t('taskAside.label'), hideTitle: true, 'onUpdate:open': onOpenChange } : {}"
  >
    <section
      ref="panel"
      class="task-aside"
      :aria-label="t('taskAside.label')"
      tabindex="-1"
      v-bind="narrow ? {} : $attrs"
    >
      <div class="task-aside__top">
        <ProjectKey :value="task.key" />
        <TaskMoveMenu class="task-aside__move" :task="task" :read-only="readOnly" />
        <button type="button" class="task-aside__close" name="close-task" :aria-label="t('taskAside.close')" @click="emit('close')">
          <X :size="16" aria-hidden="true" />
        </button>
      </div>

      <p v-if="readOnly" class="task-aside__note" data-test="read-only">{{ t('taskAside.readOnly') }}</p>

      <form class="task-aside__form" novalidate @submit.prevent="submit">
        <div class="task-aside__field">
          <label for="task-aside-title">{{ t('taskCreate.titleLabel') }}</label>
          <input
            id="task-aside-title"
            v-model="title"
            type="text"
            name="title"
            autocomplete="off"
            :readonly="readOnly"
            :aria-invalid="describedBy('title') ? 'true' : undefined"
            :aria-describedby="describedBy('title')"
          />
          <p
            v-for="(message, index) in fieldErrors.title"
            :id="`task-aside-title-error-${index}`"
            :key="`${index}-${message}`"
            class="task-aside__error"
            data-test="error-title"
          >
            {{ message }}
          </p>
        </div>

        <div class="task-aside__field">
          <label v-if="showDescriptionEditor" for="task-aside-description">{{ t('taskCreate.descriptionLabel') }}</label>
          <span v-else id="task-aside-description-label" class="task-aside__label">{{ t('taskCreate.descriptionLabel') }}</span>
          <MarkdownEditor
            v-if="showDescriptionEditor"
            id="task-aside-description"
            v-model="description"
            name="description"
            :rows="6"
            :aria-invalid="describedBy('description') ? 'true' : undefined"
            :aria-describedby="describedBy('description')"
          />
          <button v-if="showDescriptionEditor" type="button" class="task-aside__secondary-button" data-test="cancel-description" @click="cancelDescription">
            {{ t('taskAside.cancel') }}
          </button>
          <template v-else>
            <div v-if="description.trim() !== ''" class="task-aside__description" data-test="description-view" :aria-busy="submitting ? 'true' : undefined" role="group" aria-labelledby="task-aside-description-label">
              <MarkdownContent :source="description" :interactive="!readOnly" @toggle="toggleTask" />
            </div>
            <p v-else class="task-aside__note" data-test="description-empty">{{ t('taskAside.noDescription') }}</p>
            <button v-if="!readOnly" type="button" id="task-aside-description-edit" class="task-aside__secondary-button" data-test="edit-description" :disabled="submitting" @click="editingDescription = true">
              {{ t(description.trim() === '' ? 'taskAside.addDescription' : 'taskAside.editDescription') }}
            </button>
          </template>
          <p
            v-for="(message, index) in fieldErrors.description"
            :id="`task-aside-description-error-${index}`"
            :key="`${index}-${message}`"
            class="task-aside__error"
            data-test="error-description"
          >
            {{ message }}
          </p>
        </div>

        <div class="task-aside__field">
          <label for="task-aside-assignee">{{ t('taskCreate.assigneeLabel') }}</label>
          <select
            id="task-aside-assignee"
            v-model="assigneeId"
            name="assignee"
            :disabled="readOnly"
            :aria-invalid="describedBy('assignee_id') ? 'true' : undefined"
            :aria-describedby="describedBy('assignee_id')"
          >
            <option :value="null">{{ t('plan.unassigned') }}</option>
            <option v-for="member in memberOptions" :key="member.id" :value="member.id">{{ member.name }}</option>
          </select>
          <p
            v-for="(message, index) in fieldErrors.assignee_id"
            :id="`task-aside-assignee_id-error-${index}`"
            :key="`${index}-${message}`"
            class="task-aside__error"
            data-test="error-assignee"
          >
            {{ message }}
          </p>
        </div>

        <p v-if="formError" class="task-aside__error" role="alert" data-test="error-form">{{ formError }}</p>

        <button v-if="!readOnly" type="submit" class="task-aside__save" data-test="submit" :disabled="submitting || !dirty">
          {{ submitting ? t('taskAside.saving') : t('taskAside.save') }}
        </button>
      </form>

      <button v-if="canDelete" type="button" class="task-aside__delete" data-test="delete" @click="confirmOpen = true">
        <Trash2 :size="14" aria-hidden="true" />
        {{ t('taskAside.delete') }}
      </button>

      <div v-if="task.log_group" class="task-aside__origin">
        <span class="task-aside__origin-label">{{ t('taskAside.fromNotice') }}</span>
        <RouterLink
          class="task-aside__origin-link"
          data-test="origin-link"
          :to="{ name: 'project-log', params: { projectId: task.project_id }, query: { group: String(task.log_group.id) } }"
        >
          <LevelPill :level="task.log_group.level" />
          <span>{{ task.log_group.title }}</span>
          <span class="sr-only">{{ t('taskAside.openNotice') }}</span>
        </RouterLink>
      </div>
    </section>
    <AppDialog v-model:open="confirmOpen" :title="t('taskAside.deleteTitle')" :close-label="t('taskAside.cancel')">
      <p data-test="delete-text">{{ t('taskAside.deleteConfirm', { key: task.key }) }}</p>
      <div class="task-aside__actions">
        <button type="button" class="task-aside__cancel" data-test="delete-cancel" :disabled="deleting" @click="confirmOpen = false">
          {{ t('taskAside.cancel') }}
        </button>
        <button type="button" class="task-aside__confirm" data-test="delete-confirm" :disabled="deleting" @click="confirmDelete">
          {{ deleting ? t('taskAside.deleting') : t('taskAside.deleteAction') }}
        </button>
      </div>
    </AppDialog>
  </component>
</template>

<style scoped>
.task-aside {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px 20px;
  background: var(--bg);
  box-sizing: border-box;
  min-width: 0;
}
.task-aside:focus {
  outline: none;
}
.task-aside__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.task-aside__move {
  margin-left: auto;
  margin-right: 4px;
}
.task-aside__close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}
.task-aside__note {
  margin: 0;
  font-size: 13px;
  color: var(--ink-3);
}
.task-aside__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.task-aside__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.task-aside__field label,
.task-aside__label {
  font-size: 13px;
  font-weight: 600;
}
.task-aside__field input,
.task-aside__field select {
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}
.task-aside__field input,
.task-aside__field select {
  min-height: 44px;
}
.task-aside__field input:focus-visible,
.task-aside__field select:focus-visible,
.task-aside__close:focus-visible,
.task-aside__delete:focus-visible,
.task-aside__cancel:focus-visible,
.task-aside__confirm:focus-visible,
.task-aside__save:focus-visible,
.task-aside__origin-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.task-aside__error {
  margin: 0;
  color: var(--level-error-fg);
  font-size: 13px;
}
.task-aside__description {
  margin-bottom: var(--space-2);
}
.task-aside__secondary-button {
  align-self: flex-start;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}
.task-aside__secondary-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.task-aside__save {
  align-self: flex-end;
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
.task-aside__save:disabled {
  opacity: 0.6;
  cursor: default;
}
.task-aside__origin {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.task-aside__origin-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-3);
}
.task-aside__origin-link {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink);
  font-size: 13.5px;
  overflow-wrap: anywhere;
}
.task-aside__delete,
.task-aside__cancel,
.task-aside__confirm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
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
.task-aside__delete {
  align-self: flex-start;
  color: var(--level-error-fg);
}
.task-aside__confirm {
  border-color: var(--level-error-fg);
  background: var(--level-error-bg);
  color: var(--level-error-fg);
}
.task-aside__confirm:disabled,
.task-aside__cancel:disabled {
  opacity: 0.6;
  cursor: default;
}
.task-aside__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
