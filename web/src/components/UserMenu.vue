<script setup lang="ts">
import { Bell, Languages, LogOut, Mail, Monitor, Moon, Sun, Users, type LucideIcon } from '@lucide/vue'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from '../i18n'
import { saveThemePreference, themePreference as theme, type ThemePreference } from '../theme/theme'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { toast } from './ui/toast'
import AppAvatar from './ui/AppAvatar.vue'
import AppMenu, { type AppMenuItem } from './ui/AppMenu.vue'
import NotificationPreferencesDialog from './NotificationPreferencesDialog.vue'

const { t, locale } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const organization = useOrganizationStore()

const preferencesOpen = ref(false)
const triggerButton = ref<HTMLButtonElement | null>(null)

const THEME_PREFIX = 'theme:'
const LOCALE_PREFIX = 'locale:'

const THEMES: ThemePreference[] = ['system', 'light', 'dark']
const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } satisfies Record<ThemePreference, LucideIcon>

const items = computed<AppMenuItem[]>(() => [
  { value: 'members', label: t('userMenu.members'), icon: Users },
  ...(organization.canManageInvitations ? [{ value: 'invitations', label: t('userMenu.invitations'), icon: Mail }] : []),
  { value: 'notification-preferences', label: t('userMenu.notificationPreferences'), icon: Bell },
  {
    value: 'theme',
    label: t('userMenu.themeLabel'),
    icon: THEME_ICONS[theme.value],
    hint: t(`userMenu.themeOption.${theme.value}`),
    children: THEMES.map((option) => ({
      value: `${THEME_PREFIX}${option}`,
      label: t(`userMenu.themeOption.${option}`),
      icon: THEME_ICONS[option],
      checked: theme.value === option,
    })),
  },
  {
    value: 'language',
    label: t('userMenu.language'),
    icon: Languages,
    hint: LOCALE_LABELS[locale.value as Locale],
    children: SUPPORTED_LOCALES.map((option) => ({
      value: `${LOCALE_PREFIX}${option}`,
      label: LOCALE_LABELS[option],
      checked: locale.value === option,
    })),
  },
  { value: 'logout', label: t('layout.logout'), icon: LogOut, danger: true },
])

function returnFocusToTrigger(event: Event): void {
  event.preventDefault()
  void nextTick(() => triggerButton.value?.focus())
}

async function onSelect(value: string): Promise<void> {
  if (value.startsWith(THEME_PREFIX)) {
    saveThemePreference(value.slice(THEME_PREFIX.length) as ThemePreference)
    return
  }
  if (value.startsWith(LOCALE_PREFIX)) {
    const saved = await auth.chooseAndSaveLocale(value.slice(LOCALE_PREFIX.length) as Locale)
    if (!saved) toast.error(t('common.localeSaveFailed'))
    return
  }
  if (value === 'members') {
    await router.push({ name: 'members' })
    return
  }
  if (value === 'notification-preferences') {
    preferencesOpen.value = true
    return
  }
  if (value === 'invitations') {
    await router.push({ name: 'invitations' })
    return
  }
  await auth.logout()
  await router.push({ name: 'login' })
}
</script>

<template>
  <AppMenu v-if="auth.user" :items="items" side="top" @select="onSelect">
    <button ref="triggerButton" type="button" name="user-menu" class="user-menu" :aria-label="t('userMenu.label')">
      <AppAvatar :name="auth.user.name" :id="auth.user.id" />
      <span class="user-menu__name">{{ auth.user.name }}</span>
    </button>
  </AppMenu>
  <NotificationPreferencesDialog v-if="auth.user" v-model:open="preferencesOpen" @close-auto-focus="returnFocusToTrigger" />
</template>

<style scoped>
.user-menu {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 4px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  font-weight: 600;
  cursor: pointer;
}

.user-menu:hover {
  background: var(--surface);
}

.user-menu__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
