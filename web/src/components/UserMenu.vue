<script setup lang="ts">
import { LogOut, Monitor, Moon, Sun } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { readThemePreference, saveThemePreference, type ThemePreference } from '../theme/theme'
import { useAuthStore } from '../stores/auth'
import AppAvatar from './ui/AppAvatar.vue'
import AppMenu from './ui/AppMenu.vue'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

const THEME_PREFIX = 'theme:'
const theme = ref<ThemePreference>(readThemePreference())

const items = computed(() => [
  { value: `${THEME_PREFIX}system`, label: t('userMenu.theme.system'), icon: Monitor, checked: theme.value === 'system' },
  { value: `${THEME_PREFIX}light`, label: t('userMenu.theme.light'), icon: Sun, checked: theme.value === 'light' },
  { value: `${THEME_PREFIX}dark`, label: t('userMenu.theme.dark'), icon: Moon, checked: theme.value === 'dark' },
  { value: 'logout', label: t('layout.logout'), icon: LogOut, danger: true },
])

async function onSelect(value: string): Promise<void> {
  if (value.startsWith(THEME_PREFIX)) {
    theme.value = value.slice(THEME_PREFIX.length) as ThemePreference
    saveThemePreference(theme.value)
    return
  }
  await auth.logout()
  await router.push({ name: 'login' })
}
</script>

<template>
  <AppMenu v-if="auth.user" :items="items" side="top" @select="onSelect">
    <button type="button" name="user-menu" class="user-menu" :aria-label="t('userMenu.label')">
      <AppAvatar :name="auth.user.name" :id="auth.user.id" />
      <span class="user-menu__name">{{ auth.user.name }}</span>
    </button>
  </AppMenu>
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
