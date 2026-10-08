<script setup lang="ts">
import { Activity, House, MessageSquare, Monitor, Moon, Sun } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useProjectsStore } from '../stores/projects'
import { saveThemePreference, type ThemePreference } from '../theme/theme'
import AppCommand, { type AppCommandGroup, type AppCommandItem } from './ui/AppCommand.vue'

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark']
const THEME_ICONS: Record<ThemePreference, Component> = { system: Monitor, light: Sun, dark: Moon }

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const router = useRouter()
const projectsStore = useProjectsStore()

const groups = computed<AppCommandGroup[]>(() => {
  const channelLabel = t('projectTabs.channel')
  const logLabel = t('projectTabs.log')
  const navigation: AppCommandItem[] = [{ value: 'home', label: t('sidebar.home'), icon: House }]
  for (const project of projectsStore.projects) {
    const channelId = projectsStore.channelByProject[project.id]
    if (channelId !== undefined) {
      navigation.push({
        value: `channel:${channelId}`,
        label: project.name,
        hint: channelLabel,
        keywords: [project.key],
        icon: MessageSquare,
      })
    }
    navigation.push({ value: `log:${project.id}`, label: project.name, hint: logLabel, keywords: [project.key], icon: Activity })
  }
  return [
    { label: t('command.goTo'), items: navigation },
    {
      label: t('command.theme'),
      items: THEMES.map((theme) => ({ value: `theme:${theme}`, label: t(`userMenu.theme.${theme}`), icon: THEME_ICONS[theme] })),
    },
  ]
})

function onSelect(value: string): void {
  const [kind, id] = value.split(':')
  if (kind === 'home') void router.push({ name: 'projects' })
  else if (kind === 'channel') void router.push({ name: 'channel', params: { id } })
  else if (kind === 'log') void router.push({ name: 'project-log', params: { projectId: id } })
  else if (kind === 'theme' && THEMES.includes(id as ThemePreference)) saveThemePreference(id as ThemePreference)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.repeat || event.isComposing || event.altKey || event.shiftKey) return
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
  event.preventDefault()
  open.value = !open.value
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <AppCommand
    v-model:open="open"
    :title="t('command.title')"
    :placeholder="t('command.placeholder')"
    :empty-text="t('command.empty')"
    :groups="groups"
    @select="onSelect"
  />
</template>
