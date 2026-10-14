<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { getNotificationPreferences, NOTIFICATION_CHANNELS, NOTIFICATION_TYPES, updateNotificationPreferences } from '../api/notificationPreferences'
import type { NotificationChannel, NotificationPreferences, NotificationType } from '../api/types'
import { desktopPermissionGranted, requestDesktopPermission } from '../platform/desktopNotifications'
import { isDesktop } from '../platform/desktop'
import { disablePush, enablePush, getPushState, PushSubscribeError, type PushState } from '../pwa/push'
import AppButton from './ui/AppButton.vue'
import AppDialog from './ui/AppDialog.vue'
import AppFormError from './ui/AppFormError.vue'

type DeviceError = 'notConfigured' | 'browserFailed' | 'enableFailed' | 'disableFailed'

const { t } = useI18n()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ closeAutoFocus: [event: Event] }>()

const preferences = ref<NotificationPreferences | null>(null)
const loading = ref(false)
const loadFailed = ref(false)
const saving = reactive<Record<string, boolean>>({})
const saveFailed = reactive<Record<string, boolean>>({})
const deviceState = ref<PushState | null>(null)
const desktop = isDesktop()
const desktopGranted = ref<boolean | null>(null)
const deviceBusy = ref(false)
const deviceError = ref<DeviceError | null>(null)
const deviceDismissed = ref(false)
let generation = 0

const DEVICE_STATUS_ID = 'notification-preferences-device-status'
const DEVICE_ERROR_ID = 'notification-preferences-device-error'
const DEVICE_NOTICE_ID = 'notification-preferences-device-notice'

const canToggleDevice = computed(() => deviceState.value === 'active' || deviceState.value === 'inactive')
const deviceDescribedBy = computed(() => {
  if (deviceError.value) return `${DEVICE_STATUS_ID} ${DEVICE_ERROR_ID}`
  return deviceDismissed.value ? `${DEVICE_STATUS_ID} ${DEVICE_NOTICE_ID}` : DEVICE_STATUS_ID
})

function key(channel: NotificationChannel, type: NotificationType): string {
  return `${channel}-${type}`
}

function reset(): void {
  preferences.value = null
  loading.value = false
  loadFailed.value = false
  deviceState.value = null
  desktopGranted.value = null
  deviceBusy.value = false
  deviceError.value = null
  deviceDismissed.value = false
  for (const name of Object.keys(saving)) delete saving[name]
  for (const name of Object.keys(saveFailed)) delete saveFailed[name]
}

async function loadDevice(current: number): Promise<void> {
  if (desktop) {
    const granted = await desktopPermissionGranted()
    if (current === generation) desktopGranted.value = granted
    return
  }
  const state = await getPushState().catch((): PushState => 'unsupported')
  if (current !== generation) return
  deviceState.value = state
}

async function load(): Promise<void> {
  const current = ++generation
  reset()
  loading.value = true
  void loadDevice(current)
  try {
    const response = await getNotificationPreferences()
    if (current !== generation) return
    preferences.value = { email: { ...response.email }, push: { ...response.push } }
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

async function onChange(channel: NotificationChannel, type: NotificationType, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const current = preferences.value?.[channel]
  if (!current) return
  const id = key(channel, type)
  if (saving[id]) {
    input.checked = current[type]
    return
  }
  const previous = current[type]
  const next = input.checked
  const run = generation
  current[type] = next
  saving[id] = true
  delete saveFailed[id]
  try {
    const response = await updateNotificationPreferences(channel, { [type]: next })
    if (run !== generation) return
    current[type] = response[channel][type]
  } catch {
    if (run !== generation) return
    current[type] = previous
    input.checked = previous
    saveFailed[id] = true
  } finally {
    if (run === generation) delete saving[id]
  }
}

async function requestDesktopAlerts(): Promise<void> {
  if (deviceBusy.value || desktopGranted.value !== false) return
  const run = generation
  deviceBusy.value = true
  try {
    const granted = await requestDesktopPermission()
    if (run === generation) desktopGranted.value = granted
  } finally {
    if (run === generation) deviceBusy.value = false
  }
}

async function toggleDevice(): Promise<void> {
  if (deviceBusy.value || !canToggleDevice.value) return
  const run = generation
  const enabling = deviceState.value === 'inactive'
  deviceBusy.value = true
  deviceError.value = null
  deviceDismissed.value = false
  try {
    const state = enabling ? await enablePush() : await disablePush()
    if (run !== generation) return
    deviceState.value = state
    deviceDismissed.value = enabling && state === 'inactive'
  } catch (error) {
    if (run !== generation) return
    if (!enabling) deviceError.value = 'disableFailed'
    else if (error instanceof PushSubscribeError) deviceError.value = 'browserFailed'
    else if (error instanceof ApiError && error.status === 503) deviceError.value = 'notConfigured'
    else deviceError.value = 'enableFailed'
  } finally {
    if (run === generation) deviceBusy.value = false
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
      <section v-if="desktop && desktopGranted !== null" class="notification-preferences__device" data-test="device">
        <h3 class="notification-preferences__heading">{{ t('notificationPreferences.device.title') }}</h3>
        <p :id="DEVICE_STATUS_ID" class="notification-preferences__status" data-test="device-status">
          {{ t(desktopGranted ? 'notificationPreferences.device.desktop.granted' : 'notificationPreferences.device.desktop.denied') }}
        </p>
        <AppButton
          v-if="!desktopGranted"
          type="button"
          variant="secondary"
          size="sm"
          name="request-desktop-permission"
          :disabled="deviceBusy"
          :aria-busy="deviceBusy ? 'true' : undefined"
          :aria-describedby="DEVICE_STATUS_ID"
          @click="requestDesktopAlerts()"
        >
          {{ t('notificationPreferences.device.desktop.request') }}
        </AppButton>
      </section>
      <section v-else-if="!desktop && deviceState" class="notification-preferences__device" data-test="device">
        <h3 class="notification-preferences__heading">{{ t('notificationPreferences.device.title') }}</h3>
        <p :id="DEVICE_STATUS_ID" class="notification-preferences__status" data-test="device-status">
          {{ t(`notificationPreferences.device.status.${deviceState}`) }}
        </p>
        <AppButton
          v-if="canToggleDevice"
          type="button"
          variant="secondary"
          size="sm"
          name="toggle-device"
          :disabled="deviceBusy"
          :aria-busy="deviceBusy ? 'true' : undefined"
          :aria-invalid="deviceError ? 'true' : undefined"
          :aria-describedby="deviceDescribedBy"
          @click="toggleDevice()"
        >
          {{ t(deviceState === 'active' ? 'notificationPreferences.device.disable' : 'notificationPreferences.device.enable') }}
        </AppButton>
        <p v-if="deviceDismissed" :id="DEVICE_NOTICE_ID" class="notification-preferences__status" data-test="device-notice">
          {{ t('notificationPreferences.device.dismissed') }}
        </p>
        <AppFormError v-if="deviceError" :id="DEVICE_ERROR_ID" data-test="device-error">
          {{ t(`notificationPreferences.device.errors.${deviceError}`) }}
        </AppFormError>
      </section>

      <p v-if="loading" data-test="loading">{{ t('common.loading') }}</p>
      <div v-else-if="loadFailed" class="notification-preferences__failed" data-test="load-failed">
        <AppFormError>{{ t('notificationPreferences.loadFailed') }}</AppFormError>
        <AppButton type="button" variant="secondary" size="sm" name="retry" @click="load()">{{ t('common.retry') }}</AppButton>
      </div>
      <template v-else-if="preferences">
        <table class="notification-preferences__table">
          <thead>
            <tr>
              <th scope="col" class="notification-preferences__event">{{ t('notificationPreferences.event') }}</th>
              <th v-for="channel in NOTIFICATION_CHANNELS" :key="channel" scope="col" class="notification-preferences__channel">
                {{ t(`notificationPreferences.channels.${channel}`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="type in NOTIFICATION_TYPES" :key="type">
              <tr>
                <th scope="row" class="notification-preferences__event">{{ t(`notificationPreferences.types.${type}`) }}</th>
                <td v-for="channel in NOTIFICATION_CHANNELS" :key="channel" class="notification-preferences__cell">
                  <input
                    type="checkbox"
                    role="switch"
                    class="notification-preferences__switch"
                    :name="key(channel, type)"
                    :aria-label="t('notificationPreferences.switchLabel', { type: t(`notificationPreferences.types.${type}`), channel: t(`notificationPreferences.channels.${channel}`) })"
                    :checked="preferences[channel][type]"
                    :aria-disabled="saving[key(channel, type)] ? 'true' : undefined"
                    :aria-busy="saving[key(channel, type)] ? 'true' : undefined"
                    :aria-invalid="saveFailed[key(channel, type)] ? 'true' : undefined"
                    :aria-describedby="saveFailed[key(channel, type)] ? `notification-preferences-error-${key(channel, type)}` : undefined"
                    @change="onChange(channel, type, $event)"
                  />
                </td>
              </tr>
              <tr v-if="NOTIFICATION_CHANNELS.some((channel) => saveFailed[key(channel, type)])" data-test="save-error-row">
                <td :colspan="NOTIFICATION_CHANNELS.length + 1">
                  <template v-for="channel in NOTIFICATION_CHANNELS" :key="channel">
                    <AppFormError v-if="saveFailed[key(channel, type)]" :id="`notification-preferences-error-${key(channel, type)}`">
                      {{
                        t('notificationPreferences.saveFailed', {
                          type: t(`notificationPreferences.types.${type}`),
                          channel: t(`notificationPreferences.channels.${channel}`),
                        })
                      }}
                    </AppFormError>
                  </template>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </template>
    </div>
  </AppDialog>
</template>

<style scoped>
.notification-preferences {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.notification-preferences__device {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border);
}

.notification-preferences__heading {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.notification-preferences__status {
  margin: 0;
  color: var(--ink-3);
  font-size: 13px;
}

.notification-preferences__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.notification-preferences__table th,
.notification-preferences__table td {
  padding: 0;
  font-weight: 400;
  text-align: left;
}

.notification-preferences__table thead th {
  padding-bottom: var(--space-2);
  color: var(--ink-3);
  font-size: 13px;
}

.notification-preferences__event {
  padding-right: var(--space-3);
}

.notification-preferences__table .notification-preferences__channel,
.notification-preferences__table .notification-preferences__cell {
  width: 64px;
  text-align: center;
}

.notification-preferences__cell {
  height: 44px;
}

.notification-preferences__failed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

.notification-preferences__switch {
  appearance: none;
  position: relative;
  display: block;
  margin: 0 auto;
  flex: none;
  width: 36px;
  height: 20px;
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
