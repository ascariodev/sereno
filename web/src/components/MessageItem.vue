<script setup lang="ts">
import { Ellipsis, Pencil, Trash2 } from '@lucide/vue'
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message } from '../api/types'
import AppAvatar from './ui/AppAvatar.vue'
import AppMenu, { type AppMenuItem } from './ui/AppMenu.vue'
import AppTooltip from './ui/AppTooltip.vue'
import MessageAttachments from './MessageAttachments.vue'
import MessageBody from './MessageBody.vue'
import MessageEditor from './MessageEditor.vue'
import { messageActionsKey } from './messageActions'
import ThreadSummary from './ThreadSummary.vue'

const props = defineProps<{ message: Message; threadable?: boolean; ownUserId?: number }>()
const emit = defineEmits<{ openThread: [messageId: number] }>()

const { t, locale } = useI18n()

const author = computed(() => props.message.user?.name ?? t('channel.unknownUser'))
const date = computed(() => new Date(props.message.created_at))
const shortTime = computed(() => date.value.toLocaleTimeString(locale.value, { timeStyle: 'short' }))
const fullDate = computed(() => date.value.toLocaleString(locale.value, { dateStyle: 'full', timeStyle: 'medium' }))
const deleted = computed(() => props.message.deleted_at !== null)
const actions = inject(messageActionsKey, null)
const canAct = computed(
  () =>
    actions !== null &&
    props.ownUserId !== undefined &&
    props.message.kind === 'user' &&
    !deleted.value &&
    props.message.user?.id === props.ownUserId,
)
const editing = computed(
  () =>
    canAct.value &&
    actions?.editingId.value === props.message.id &&
    !(props.threadable && props.message.parent_id === null && actions.threadRootId.value === props.message.id),
)
const showMenu = computed(() => canAct.value && actions?.editingId.value !== props.message.id)
const menuItems = computed<AppMenuItem[]>(() => [
  { value: 'edit', label: t('message.edit'), icon: Pencil },
  { value: 'delete', label: t('message.delete'), icon: Trash2, danger: true },
])
function onSelect(value: string): void {
  if (value === 'edit') actions?.edit(props.message)
  else if (value === 'delete') actions?.remove(props.message)
}
const editedDate = computed(() =>
  props.message.edited_at === null
    ? ''
    : new Date(props.message.edited_at).toLocaleString(locale.value, { dateStyle: 'full', timeStyle: 'medium' }),
)
</script>

<template>
  <article class="message-item">
    <AppAvatar :name="author" :id="message.user?.id ?? 0" :size="34" />
    <div v-if="showMenu" class="message-item__actions" data-test="actions">
      <AppMenu :items="menuItems" align="end" @select="onSelect">
        <button type="button" class="message-item__actions-trigger" :aria-label="t('message.actions')">
          <Ellipsis :size="16" aria-hidden="true" />
        </button>
      </AppMenu>
    </div>
    <div class="message-item__main">
      <p class="message-item__meta">
        <strong>{{ author }}</strong>
        <AppTooltip :text="fullDate">
          <time :datetime="message.created_at">
            <span aria-hidden="true">{{ shortTime }}</span>
            <span class="sr-only">{{ fullDate }}</span>
          </time>
        </AppTooltip>
        <AppTooltip v-if="!deleted && message.edited_at" :text="t('message.editedAt', { date: editedDate })">
          <span class="message-item__edited" data-test="edited"><span aria-hidden="true">{{ t('message.edited') }}</span><span class="sr-only">{{ t('message.editedAt', { date: editedDate }) }}</span></span>
        </AppTooltip>
      </p>
      <p v-if="deleted" class="message-item__deleted" data-test="deleted">{{ t('message.deleted') }}</p>
      <MessageEditor v-else-if="editing" :message="message" @done="actions?.stopEdit()" />
      <template v-else>
        <p v-if="message.body" class="message-item__body"><MessageBody :body="message.body" :mentions="message.mentions" :own-user-id="ownUserId" /></p>
        <MessageAttachments :attachments="message.attachments" />
      </template>
      <ThreadSummary v-if="threadable && message.parent_id === null" :message="message" @open="emit('openThread', $event)" />
    </div>
  </article>
</template>

<style scoped>
.message-item {
  position: relative;
  display: flex;
  gap: 12px;
}

.message-item__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.message-item__meta,
.message-item__body {
  margin: 0;
}

.message-item__meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.message-item__meta strong {
  font-weight: 600;
}

.message-item__meta time {
  position: relative;
  font-size: 12px;
  color: var(--ink-3);
}

.message-item__edited {
  font-size: 12px;
  color: var(--ink-3);
}

.message-item__deleted {
  margin: 2px 0 0;
  color: var(--ink-3);
  font-style: italic;
}

.message-item__body {
  margin-top: 2px;
  color: var(--ink-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.message-item__actions {
  position: absolute;
  top: -4px;
  right: 0;
  opacity: 0;
}

.message-item:hover .message-item__actions,
.message-item:focus-within .message-item__actions,
.message-item__actions:has([data-state='open']) {
  opacity: 1;
}

@media (hover: none) {
  .message-item__actions {
    opacity: 1;
  }
}

.message-item__actions-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: var(--surface);
  color: var(--ink-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  cursor: pointer;
}
</style>
