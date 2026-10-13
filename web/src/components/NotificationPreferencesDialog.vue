<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getNotificationPreferences, NOTIFICATION_EMAIL_TYPES, updateNotificationPreferences } from '../api/notificationPreferences'
import type { NotificationEmailType, NotificationPreferences } from '../api/types'
import AppButton from './ui/AppButton.vue'
import AppDialog from './ui/AppDialog.vue'
import AppFormError from './ui/AppFormError.vue'

const { t } = useI18n()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ closeAutoFocus: [event: Event] }>()

const preferences = ref<NotificationPreferences['email'] | null>(null)
const loading = ref(false)
const loadFailed = ref(false)
const saving = reactive<Partial<Record<NotificationEmailType, boolean>>>({})
const saveFailed = reactive<Partial<Record<NotificationEmailType, boolean>>>({})
let generation = 0

function reset(): void {
  preferences.value = null
  loading.value = false
  loadFailed.value = false
  for (const type of NOTIFICATION_EMAIL_TYPES) {
    delete saving[type]
    delete saveFailed[type]
  }
}

async function load(): Promise<void> {
  const current = ++generation
  reset()
  loading.value = true
  try {
    const response = await getNotificationPreferences()
    if (current !== generation) return
    preferences.value = { ...response.email }
  } catch {
    if (current !== generation) return
    loadFailed.value = true
  } finally {
    if (current === generation) loading.value = false
  }
}

watch(
  open,
  (isOpen) => {
    if (isOpen) {
      void load()
    } else {
      generation++
      reset()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  generation++
})

async function onChange(type: NotificationEmailType, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const current = preferences.value
  if (!current) return
  if (saving[type]) {
    input.checked = current[type]
    return
  }
  const previous = current[type]
  const next = input.checked
  const run = generation
  current[type] = next
  saving[type] = true
  delete saveFailed[type]
  try {
    const response = await updateNotificationPreferences({ [type]: next })
    if (run !== generation) return
    current[type] = response.email[type]
  } catch {
    if (run !== generation) return
    current[type] = previous
    input.checked = previous
    saveFailed[type] = true
  } finally {
    if (run === generation) delete saving[type]
  }
}
</script>

<template>
  <AppDialog
    v-model:open="open"
    :title="t('notificationPreferences.title')"
    :description="t('notificationPreferences.description')"
    :close-label="t('notificationPreferences.close')"
    @close-auto-focus="emit('closeAutoFocus', $event)"
  >
    <div class="notification-preferences">
      <p v-if="loading" data-test="loading">{{ t('common.loading') }}</p>
      <div v-else-if="loadFailed" class="notification-preferences__failed" data-test="load-failed">
        <AppFormError>{{ t('notificationPreferences.loadFailed') }}</AppFormError>
        <AppButton type="button" variant="secondary" size="sm" name="retry" @click="load()">{{ t('common.retry') }}</AppButton>
      </div>
      <ul v-else-if="preferences" class="notification-preferences__list">
        <li v-for="type in NOTIFICATION_EMAIL_TYPES" :key="type" class="notification-preferences__item">
          <label class="notification-preferences__row">
            <span>{{ t(`notificationPreferences.types.${type}`) }}</span>
            <input
              type="checkbox"
              role="switch"
              class="notification-preferences__switch"
              :name="`email-${type}`"
              :checked="preferences[type]"
              :aria-disabled="saving[type] ? 'true' : undefined"
              :aria-busy="saving[type] ? 'true' : undefined"
              :aria-invalid="saveFailed[type] ? 'true' : undefined"
              :aria-describedby="saveFailed[type] ? `notification-preferences-error-${type}` : undefined"
              @change="onChange(type, $event)"
            />
          </label>
          <AppFormError v-if="saveFailed[type]" :id="`notification-preferences-error-${type}`">
            {{ t('notificationPreferences.saveFailed') }}
          </AppFormError>
        </li>
      </ul>
    </div>
  </AppDialog>
</template>

<style scoped>
.notification-preferences__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.notification-preferences__failed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

.notification-preferences__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 44px;
  font-size: 14px;
  cursor: pointer;
}

.notification-preferences__switch {
  appearance: none;
  position: relative;
  flex: none;
  width: 36px;
  height: 20px;
  margin: 0;
  border-radius: 999px;
  background: var(--ink-3);
  cursor: pointer;
  transition: background 120ms ease;
}

.notification-preferences__switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--surface);
  transition: transform 120ms ease;
}

.notification-preferences__switch:checked {
  background: var(--accent);
}

.notification-preferences__switch:checked::after {
  transform: translateX(16px);
}

.notification-preferences__switch[aria-disabled='true'] {
  opacity: 0.6;
  cursor: default;
}

.notification-preferences__switch:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .notification-preferences__switch,
  .notification-preferences__switch::after {
    transition: none;
  }
}
</style>
