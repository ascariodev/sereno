<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { useSharedNow } from '../composables/useSharedNow'
import { useAuthStore } from '../stores/auth'
import { useMemberDirectoryStore } from '../stores/memberDirectory'
import { useTaskCommentsStore } from '../stores/taskComments'
import MarkdownContent from './MarkdownContent.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import { charCount, TASK_DESCRIPTION_MAX_LENGTH } from './taskLimits'
import AppAvatar from './ui/AppAvatar.vue'
import AppFormError from './ui/AppFormError.vue'

const props = defineProps<{ projectId: number; taskId: number }>()

const { t, locale } = useI18n()
const store = useTaskCommentsStore()
const auth = useAuthStore()
const directory = useMemberDirectoryStore()
const now = useSharedNow()

const draft = ref('')
const sending = ref(false)
const formError = ref<string | null>(null)
let sendToken = 0

watch(
  () => `${props.projectId}:${props.taskId}`,
  () => {
    sendToken++
    draft.value = ''
    sending.value = false
    formError.value = null
    void store.open(props.projectId, props.taskId)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  sendToken++
  store.clear()
})

const mentionOptions = computed(() => ({
  members: directory.membersOf(props.projectId),
  excludeUserId: auth.user?.id,
  ensureLoaded: () => directory.ensureLoaded(props.projectId),
}))

const empty = computed(() => !store.loading && store.error === null && store.comments.length === 0)
const canSend = computed(() => !sending.value && draft.value.trim() !== '' && charCount(draft.value) <= TASK_DESCRIPTION_MAX_LENGTH)

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

function when(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now.value) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.trunc(seconds / size), unit)
  }
  return formatter.format(0, 'second')
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(locale.value, { dateStyle: 'full', timeStyle: 'medium' })
}

function retry(): void {
  if (store.comments.length === 0) void store.open(props.projectId, props.taskId)
  else void store.loadOlder()
}

async function submit(): Promise<void> {
  if (!canSend.value) return
  const token = ++sendToken
  formError.value = null
  sending.value = true
  try {
    await store.send(draft.value.trim())
    if (token === sendToken) draft.value = ''
  } catch (error) {
    if (token !== sendToken) return
    if (!(error instanceof ApiError)) throw error
    if (error.status === 422) formError.value = error.message
    else if (error.status === 429) formError.value = t('taskComments.tooManyAttempts')
    else if (error.status === 0) formError.value = t('taskComments.network')
    else formError.value = t('taskComments.sendFailed')
  } finally {
    if (token === sendToken) sending.value = false
  }
}
</script>

<template>
  <section class="task-comments" :aria-label="t('taskComments.heading')" data-test="task-comments">
    <h2 class="task-comments__heading">{{ t('taskComments.heading') }}</h2>

    <p v-if="store.loading" class="task-comments__note" data-test="comments-loading">{{ t('common.loading') }}</p>

    <div v-else-if="store.error" class="task-comments__error" data-test="comments-error">
      <AppFormError>{{ t('taskComments.loadFailed') }}</AppFormError>
      <button type="button" class="task-comments__button" data-test="comments-retry" @click="retry">{{ t('common.retry') }}</button>
    </div>

    <p v-if="empty" class="task-comments__note" data-test="comments-empty">{{ t('taskComments.empty') }}</p>

    <button
      v-if="store.nextCursor !== null && !store.loading"
      type="button"
      class="task-comments__button"
      data-test="load-older"
      :disabled="store.loadingMore"
      @click="store.loadOlder()"
    >
      {{ store.loadingMore ? t('common.loading') : t('taskComments.loadOlder') }}
    </button>

    <ul v-if="store.comments.length > 0" class="task-comments__list">
      <li v-for="comment in store.comments" :key="comment.id" class="task-comments__item" data-test="comment">
        <AppAvatar v-if="comment.user" :name="comment.user.name" :id="comment.user.id" :size="28" />
        <div class="task-comments__main">
          <p class="task-comments__meta">
            <span class="task-comments__author" data-test="comment-author">{{ comment.user?.name ?? t('taskComments.deletedUser') }}</span>
            <time :datetime="comment.created_at" :title="fullDate(comment.created_at)">{{ when(comment.created_at) }}</time>
          </p>
          <MarkdownContent :source="comment.body" :mentions="comment.mentions" :own-user-id="auth.user?.id" />
        </div>
      </li>
    </ul>

    <form class="task-comments__form" novalidate @submit.prevent="submit">
      <label class="task-comments__label" for="task-comment-body">{{ t('taskComments.newLabel') }}</label>
      <MarkdownEditor
        id="task-comment-body"
        v-model="draft"
        name="comment"
        :rows="3"
        :max-length="TASK_DESCRIPTION_MAX_LENGTH"
        :readonly="sending"
        :mentions="mentionOptions"
      />
      <AppFormError v-if="formError" data-test="comment-error">{{ formError }}</AppFormError>
      <button type="submit" class="task-comments__send" data-test="comment-send" :disabled="!canSend">
        {{ sending ? t('taskComments.sending') : t('taskComments.send') }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.task-comments {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.task-comments__heading {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.task-comments__note {
  margin: 0;
  font-size: 13px;
  color: var(--ink-3);
}
.task-comments__error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.task-comments__list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.task-comments__item {
  display: flex;
  gap: 10px;
  min-width: 0;
}
.task-comments__main {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.task-comments__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 2px;
  font-size: 12px;
  color: var(--ink-3);
}
.task-comments__author {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.task-comments__form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.task-comments__label {
  font-size: 13px;
  font-weight: 600;
}
.task-comments__button {
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
.task-comments__button:disabled {
  opacity: 0.6;
  cursor: default;
}
.task-comments__send {
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
.task-comments__send:disabled {
  opacity: 0.6;
  cursor: default;
}
.task-comments__button:focus-visible,
.task-comments__send:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
