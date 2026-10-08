<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { listMembers, removeMember, updateMemberRole } from '../api/members'
import type { InvitationRole, Member } from '../api/types'
import AppDialog from '../components/ui/AppDialog.vue'
import { toast } from '../components/ui/toast'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'

const { t, locale } = useI18n()
const organization = useOrganizationStore()
const auth = useAuthStore()
const router = useRouter()

const members = ref<Member[]>([])
const loading = ref(false)
const failed = ref(false)
const savingId = ref<number | null>(null)
const roleError = ref<{ id: number; message: string } | null>(null)
const pending = ref<Member | null>(null)
const removing = ref(false)
let leaving = false
let generation = 0
let controller: AbortController | null = null

const confirmOpen = computed({
  get: () => pending.value !== null,
  set: (open: boolean) => {
    if (!open && !removing.value) pending.value = null
  },
})

const pendingIsSelf = computed(() => pending.value !== null && pending.value.id === auth.user?.id)

function isSelf(member: Member): boolean {
  return member.id === auth.user?.id
}

function canRemove(member: Member): boolean {
  return isSelf(member) || organization.canRemoveMember(member.role)
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleDateString(locale.value, { dateStyle: 'medium' })
}

async function load(): Promise<void> {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  members.value = []
  failed.value = false
  savingId.value = null
  roleError.value = null
  pending.value = null
  loading.value = true
  try {
    const result = await listMembers(controller.signal)
    if (current !== generation) return
    members.value = result
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    failed.value = true
  } finally {
    if (current === generation) loading.value = false
  }
}

async function changeRole(member: Member, event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement
  const role = select.value as InvitationRole
  if (savingId.value !== null || role === member.role) {
    select.value = member.role ?? ''
    return
  }
  const current = generation
  savingId.value = member.id
  roleError.value = null
  try {
    const updated = await updateMemberRole(member.id, role)
    if (current !== generation) return
    members.value = members.value.map((m) => (m.id === updated.id ? updated : m))
    if (member.id === auth.user?.id) {
      await organization.load()
      if (current !== generation) return
    }
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    select.value = member.role ?? ''
    roleError.value = {
      id: member.id,
      message: error.status === 422 || error.status === 403 ? error.message : t('members.roleFailed'),
    }
  } finally {
    if (current === generation) savingId.value = null
  }
}

/**
 * Reloads organizations even if the user switched organization during the DELETE, so the one just left
 * disappears everywhere. Only the toast and the navigation depend on the screen still being current.
 */
async function leave(stillCurrent: boolean): Promise<void> {
  leaving = true
  try {
    try {
      await organization.load()
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (stillCurrent) toast.error(t('members.leftReloadFailed'))
      return
    }
    if (!stillCurrent) return
    toast.success(t('members.left'))
    if (router.currentRoute.value.name !== 'members') return
    await router.replace({ name: 'projects' })
  } finally {
    leaving = false
  }
}

async function confirmRemove(): Promise<void> {
  const target = pending.value
  if (!target || removing.value) return
  const current = generation
  const self = isSelf(target)
  removing.value = true
  roleError.value = null
  try {
    await removeMember(target.id)
    if (self) {
      const stillCurrent = current === generation
      if (stillCurrent) pending.value = null
      await leave(stillCurrent)
      return
    }
    if (current !== generation) return
    members.value = members.value.filter((m) => m.id !== target.id)
    toast.success(t('members.removed', { name: target.name }))
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (current !== generation) return
    if (error.status === 404) {
      members.value = members.value.filter((m) => m.id !== target.id)
      toast.info(t('members.removeGone'))
    } else {
      roleError.value = {
        id: target.id,
        message:
          error.status === 422 || error.status === 403
            ? error.message
            : t(self ? 'members.leaveFailed' : 'members.removeFailed'),
      }
    }
  } finally {
    removing.value = false
    if (current === generation) pending.value = null
  }
}

watch(
  () => organization.activeId,
  (activeId) => {
    if (leaving) return
    if (activeId !== null) {
      void load()
      return
    }
    generation++
    controller?.abort()
    members.value = []
    savingId.value = null
    roleError.value = null
    pending.value = null
    loading.value = false
    failed.value = false
  },
  { immediate: true },
)

onUnmounted(() => {
  generation++
  controller?.abort()
})
</script>

<template>
  <section class="members">
    <header class="members__header">
      <h1 class="members__title">{{ t('members.title') }}</h1>
    </header>
    <p v-if="loading" data-test="loading">{{ t('common.loading') }}</p>
    <p v-else-if="failed" role="alert" data-test="load-failed">
      {{ t('members.loadFailed') }}
      <button type="button" name="retry" @click="load">{{ t('common.retry') }}</button>
    </p>
    <p v-else-if="members.length === 0" class="members__empty" data-test="empty">
      {{ t('members.empty') }}
    </p>
    <ul v-else class="members__list">
      <li v-for="member in members" :key="member.id" class="members__item" data-test="member">
        <div class="members__main">
          <strong class="members__name">
            <span data-test="name">{{ member.name }}</span>
            <span v-if="member.id === auth.user?.id" class="members__you" data-test="you">{{ t('members.you') }}</span>
          </strong>
          <span class="members__email" data-test="email">{{ member.email }}</span>
        </div>
        <dl class="members__details">
          <div>
            <dt>{{ t('members.role') }}</dt>
            <dd v-if="organization.assignableRolesFor(member.role).length === 0" data-test="role">
              {{ member.role ? t(`invite.roles.${member.role}`) : t('members.noRole') }}
            </dd>
            <dd v-else>
              <select
                data-test="role-select"
                :aria-label="t('members.changeRoleFor', { name: member.name })"
                :aria-invalid="roleError?.id === member.id || undefined"
                :aria-describedby="roleError?.id === member.id ? `role-error-${member.id}` : undefined"
                :disabled="savingId === member.id"
                :value="member.role ?? ''"
                @change="changeRole(member, $event)"
              >
                <option v-if="!member.role" value="" disabled>{{ t('members.noRole') }}</option>
                <option v-for="role in organization.assignableRolesFor(member.role)" :key="role" :value="role">
                  {{ t(`invite.roles.${role}`) }}
                </option>
              </select>
            </dd>
          </div>
          <div>
            <dt>{{ t('members.joined') }}</dt>
            <dd data-test="joined">{{ formatDate(member.joined_at) }}</dd>
          </div>
        </dl>
        <button
          v-if="canRemove(member)"
          type="button"
          class="members__remove"
          :data-test="isSelf(member) ? 'leave' : 'remove'"
          :aria-label="isSelf(member) ? t('members.leaveTitle') : t('members.removeFor', { name: member.name })"
          :aria-describedby="roleError?.id === member.id ? `role-error-${member.id}` : undefined"
          :disabled="savingId === member.id || removing"
          @click="pending = member"
        >
          {{ isSelf(member) ? t('members.leave') : t('members.remove') }}
        </button>
        <p v-if="roleError?.id === member.id" :id="`role-error-${member.id}`" class="members__error" role="alert" data-test="role-error">
          {{ roleError.message }}
        </p>
      </li>
    </ul>

    <AppDialog
      v-model:open="confirmOpen"
      :title="pendingIsSelf ? t('members.leaveTitle') : t('members.removeTitle')"
      :close-label="t('members.cancel')"
    >
      <p v-if="pending" data-test="confirm-text">
        {{
          pendingIsSelf
            ? t('members.leaveConfirm', { organization: organization.active?.name ?? '' })
            : t('members.removeConfirm', { name: pending.name })
        }}
      </p>
      <div class="members__actions">
        <button type="button" class="members__cancel" data-test="cancel" :disabled="removing" @click="pending = null">
          {{ t('members.cancel') }}
        </button>
        <button type="button" class="members__confirm" data-test="confirm" :disabled="removing" @click="confirmRemove">
          {{
            removing
              ? t(pendingIsSelf ? 'members.leaving' : 'members.removing')
              : t(pendingIsSelf ? 'members.leaveAction' : 'members.removeAction')
          }}
        </button>
      </div>
    </AppDialog>
  </section>
</template>

<style scoped>
.members {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 760px;
  margin: 0 auto;
  padding: 44px 32px 40px;
}

.members p {
  margin: 0;
}

.members__header {
  margin-bottom: 12px;
}

.members__title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.members__empty {
  padding: 40px 16px;
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-panel);
  color: var(--ink-3);
  text-align: center;
}

.members__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.members__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

.members__main {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.members__name {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-wrap: anywhere;
}

.members__you {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--border);
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
}

.members__email {
  overflow-wrap: anywhere;
  color: var(--ink-3);
  font-size: 13px;
}

.members__details {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  font-size: 13px;
}

.members__details div {
  display: flex;
  gap: 8px;
}

.members__details dt {
  color: var(--ink-3);
}

.members__error {
  flex: 1 1 100%;
  color: var(--level-error-fg);
  font-size: 13px;
}

.members__details dd {
  margin: 0;
  color: var(--ink-2);
}

.members__remove,
.members__cancel,
.members__confirm {
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

.members__remove {
  min-width: 96px;
  color: var(--level-error-fg);
}

.members__confirm {
  border-color: var(--level-error-fg);
  background: var(--level-error-bg);
  color: var(--level-error-fg);
}

.members__remove:disabled,
.members__confirm:disabled,
.members__cancel:disabled {
  opacity: 0.6;
  cursor: default;
}

.members__remove:focus-visible,
.members__cancel:focus-visible,
.members__confirm:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.members__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

@media (max-width: 600px) {
  .members {
    padding: 24px 16px;
  }
}
</style>
