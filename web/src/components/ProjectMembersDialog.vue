<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { listMembers } from '../api/members'
import { assignProjectMember, listProjectMembers, unassignProjectMember } from '../api/projects'
import type { Member } from '../api/types'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useOrganizationStore } from '../stores/organization'
import AppAvatar from './ui/AppAvatar.vue'
import AppButton from './ui/AppButton.vue'
import AppDialog from './ui/AppDialog.vue'
import AppSelect from './ui/AppSelect.vue'
import { toast } from './ui/toast'

const props = defineProps<{ projectId: number }>()
const directory = useMemberDirectoryStore()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const organization = useOrganizationStore()

const projectMembers = ref<Member[]>([])
const organizationMembers = ref<Member[]>([])
const loading = ref(false)
const failed = ref(false)
const selectedId = ref('')
const busy = ref(false)
const actionError = ref<string | null>(null)
let generation = 0
let controller: AbortController | null = null

const candidates = computed(() => {
  const assigned = new Set(projectMembers.value.map((m) => m.id))
  return organizationMembers.value.filter((m) => m.role === 'member' && !assigned.has(m.id))
})

function reset(): void {
  generation++
  controller?.abort()
  controller = null
  projectMembers.value = []
  organizationMembers.value = []
  loading.value = false
  failed.value = false
  selectedId.value = ''
  busy.value = false
  actionError.value = null
}

async function load(): Promise<void> {
  reset()
  const current = generation
  controller = new AbortController()
  const { signal } = controller
  loading.value = true
  try {
    const [assigned, all] = await Promise.all([listProjectMembers(props.projectId, signal), listMembers(signal)])
    if (current !== generation) return
    projectMembers.value = assigned
    organizationMembers.value = all
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    failed.value = true
  } finally {
    if (current === generation) loading.value = false
  }
}

function failureMessage(error: ApiError, fallbackKey: string): string {
  if (error.status === 422 || error.status === 403) return error.message
  return t(fallbackKey)
}

async function assign(): Promise<void> {
  const target = candidates.value.find((m) => String(m.id) === selectedId.value)
  if (!target || busy.value) return
  const current = generation
  busy.value = true
  actionError.value = null
  try {
    const added = await assignProjectMember(props.projectId, target.id)
    directory.invalidate(props.projectId)
    if (current !== generation) return
    projectMembers.value = [...projectMembers.value.filter((m) => m.id !== added.id), added]
    selectedId.value = ''
    toast.success(t('projectMembers.added', { name: added.name }))
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 404) return load()
    actionError.value = failureMessage(error, 'projectMembers.addFailed')
  } finally {
    if (current === generation) busy.value = false
  }
}

async function unassign(member: Member): Promise<void> {
  if (busy.value) return
  const current = generation
  busy.value = true
  actionError.value = null
  try {
    await unassignProjectMember(props.projectId, member.id)
    directory.invalidate(props.projectId)
    if (current !== generation) return
    projectMembers.value = projectMembers.value.filter((m) => m.id !== member.id)
    toast.success(t('projectMembers.removed', { name: member.name }))
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 404) return load()
    actionError.value = failureMessage(error, 'projectMembers.removeFailed')
  } finally {
    if (current === generation) busy.value = false
  }
}

watch(open, (value) => {
  if (value) void load()
  else reset()
})

watch(
  () => [props.projectId, organization.activeId],
  () => {
    if (open.value) open.value = false
    else reset()
  },
)

onUnmounted(() => {
  generation++
  controller?.abort()
})
</script>

<template>
  <AppDialog v-model:open="open" :title="t('projectMembers.title')" :close-label="t('projectMembers.close')">
    <div class="project-members">
      <p v-if="loading" data-test="loading">{{ t('common.loading') }}</p>
      <p v-else-if="failed" role="alert" data-test="load-failed">
        {{ t('projectMembers.loadFailed') }}
        <AppButton type="button" variant="secondary" size="sm" name="retry" @click="load()">{{ t('common.retry') }}</AppButton>
      </p>
      <template v-else>
        <ul class="project-members__list">
          <li v-for="member in projectMembers" :key="member.id" class="project-members__item" data-test="member">
            <AppAvatar :name="member.name" :id="member.id" :size="30" />
            <div class="project-members__main">
              <strong data-test="name">{{ member.name }}</strong>
              <span class="project-members__email">{{ member.email }}</span>
            </div>
            <AppButton
              v-if="member.role === 'member'"
              type="button"
              variant="secondary"
              size="sm"
              data-test="remove"
              :aria-label="t('projectMembers.removeFor', { name: member.name })"
              :disabled="busy"
              @click="unassign(member)"
            >
              {{ t('projectMembers.remove') }}
            </AppButton>
            <span v-else class="project-members__always" data-test="always">{{ t('projectMembers.alwaysSees') }}</span>
          </li>
        </ul>

        <form class="project-members__add" novalidate @submit.prevent="assign">
          <p v-if="candidates.length === 0" class="project-members__none" data-test="no-candidates">
            <span class="project-members__label">{{ t('projectMembers.add') }}</span>
            {{ t('projectMembers.noCandidates') }}
          </p>
          <div v-else class="project-members__row">
            <div class="project-members__field">
              <AppSelect
                id="project-members-select"
                v-model="selectedId"
                :label="t('projectMembers.add')"
                :describedby="actionError ? 'project-members-error' : undefined"
                :invalid="!!actionError"
                name="user"
              >
                <option value="" disabled>{{ t('projectMembers.choose') }}</option>
                <option v-for="candidate in candidates" :key="candidate.id" :value="String(candidate.id)">
                  {{ candidate.name }} ({{ candidate.email }})
                </option>
              </AppSelect>
            </div>
            <AppButton type="submit" size="md" data-test="assign" :disabled="busy || selectedId === ''">
              {{ t('projectMembers.assign') }}
            </AppButton>
          </div>
        </form>
        <p v-if="actionError" id="project-members-error" class="project-members__error" role="alert" data-test="action-error">
          {{ actionError }}
        </p>
      </template>
    </div>
  </AppDialog>
</template>

<style scoped>
.project-members {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.project-members p {
  margin: 0;
}

.project-members__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.project-members__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}

.project-members__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.project-members__email,
.project-members__always,
.project-members__none {
  color: var(--ink-3);
  font-size: 13px;
}

.project-members__add {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.project-members__label {
  display: block;
  margin-bottom: 6px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
}

.project-members__row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.project-members__field {
  flex: 1;
  min-width: 0;
}

.project-members__error {
  color: var(--level-error-fg);
  font-size: 13px;
}
</style>
