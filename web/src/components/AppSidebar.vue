<script setup lang="ts">
import { House, PanelLeftClose, PanelLeftOpen, Search } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { LOG_LEVELS } from '../api/logLevels'
import type { Project } from '../api/types'
import { useOrganizationStore } from '../stores/organization'
import { isApple } from '../platform'
import { useProjectsStore } from '../stores/projects'
import OrgSwitcher from './OrgSwitcher.vue'
import UserMenu from './UserMenu.vue'
import AppTooltip from './ui/AppTooltip.vue'
import ProjectKey from './ui/ProjectKey.vue'

const props = defineProps<{ collapsed?: boolean; collapsible?: boolean }>()
defineEmits<{ search: []; toggle: [] }>()

const { t } = useI18n()
const organization = useOrganizationStore()
const projectsStore = useProjectsStore()
const route = useRoute()

const activeProjectId = computed<number | null>(() => {
  if (route.name === 'project-log') return Number(route.params.projectId)
  if (route.name !== 'channel') return null
  const channelId = Number(route.params.id)
  const entry = Object.entries(projectsStore.channelByProject).find(([, id]) => id === channelId)
  return entry ? Number(entry[0]) : null
})

interface OpenSummary {
  count: number
  tone: string
  label: string
}

function openSummary(project: Project): OpenSummary | null {
  const count = project.open_groups_count
  if (typeof count !== 'number' || count <= 0) return null
  const level = project.open_max_level
  const tone = level && LOG_LEVELS.includes(level) ? level : 'debug'
  const groups = t('sidebar.openGroups', { n: count }, count)
  return { count, tone, label: t('sidebar.projectOpen', { name: project.name, groups, level: t(`notice.level.${tone}`) }) }
}

function linkLabel(project: Project): string | undefined {
  return openSummary(project)?.label ?? (props.collapsed ? project.name : undefined)
}

function currentFor(projectId: number): 'page' | undefined {
  return activeProjectId.value === projectId ? 'page' : undefined
}
</script>

<template>
  <nav :class="['app-sidebar', { 'app-sidebar--collapsed': collapsed }]" :aria-label="t('sidebar.label')">
    <div class="app-sidebar__top">
      <strong v-if="!collapsed" class="app-sidebar__brand">{{ t('app.name') }}</strong>
      <AppTooltip
        v-if="collapsible"
        :text="collapsed ? t('sidebar.expand') : t('sidebar.collapse')"
        side="right"
      >
        <button
          type="button"
          name="sidebar-toggle"
          class="app-sidebar__toggle"
          :aria-label="collapsed ? t('sidebar.expand') : t('sidebar.collapse')"
          :aria-expanded="!collapsed"
          @click="$emit('toggle')"
        >
          <PanelLeftOpen v-if="collapsed" :size="17" aria-hidden="true" />
          <PanelLeftClose v-else :size="17" aria-hidden="true" />
        </button>
      </AppTooltip>
    </div>

    <OrgSwitcher />

    <div class="app-sidebar__group">
      <AppTooltip :text="t('command.open')" side="right" :disabled="!collapsed">
        <button
          type="button"
          name="search"
          class="app-sidebar__link app-sidebar__search"
          aria-haspopup="dialog"
          :aria-label="collapsed ? t('command.open') : undefined"
          :aria-keyshortcuts="isApple ? 'Meta+K' : 'Control+K'"
          @click="$emit('search')"
        >
          <Search :size="17" aria-hidden="true" />
          <template v-if="!collapsed">
            <span class="app-sidebar__name">{{ t('command.open') }}</span>
            <kbd class="app-sidebar__kbd" aria-hidden="true">{{ isApple ? '⌘K' : 'Ctrl K' }}</kbd>
          </template>
        </button>
      </AppTooltip>
      <AppTooltip :text="t('sidebar.home')" side="right" :disabled="!collapsed">
        <RouterLink
          :to="{ name: 'projects' }"
          class="app-sidebar__link"
          :aria-label="collapsed ? t('sidebar.home') : undefined"
        >
          <House :size="17" aria-hidden="true" />
          <span v-if="!collapsed">{{ t('sidebar.home') }}</span>
        </RouterLink>
      </AppTooltip>
    </div>

    <div v-if="organization.activeId !== null" class="app-sidebar__group">
      <span v-if="!collapsed" class="app-sidebar__heading">{{ t('projects.title') }}</span>
      <template v-for="project in projectsStore.projects" :key="project.id">
        <AppTooltip :text="project.name" side="right" :disabled="!collapsed">
          <RouterLink
            v-if="projectsStore.channelByProject[project.id] !== undefined"
            :to="{ name: 'channel', params: { id: projectsStore.channelByProject[project.id] } }"
            class="app-sidebar__link app-sidebar__project"
            :aria-label="linkLabel(project)"
            :aria-current="currentFor(project.id)"
          >
            <ProjectKey :value="project.key" />
            <span v-if="!collapsed" class="app-sidebar__name">{{ project.name }}</span>
            <span
              v-if="openSummary(project)"
              :class="['app-sidebar__open', `app-sidebar__open--${openSummary(project)!.tone}`]"
              aria-hidden="true"
              >{{ openSummary(project)!.count }}</span
            >
          </RouterLink>
          <span
            v-else
            class="app-sidebar__link app-sidebar__project app-sidebar__project--disabled"
            role="link"
            aria-disabled="true"
            :aria-label="linkLabel(project)"
            :aria-current="currentFor(project.id)"
          >
            <ProjectKey :value="project.key" />
            <span v-if="!collapsed" class="app-sidebar__name">{{ project.name }}</span>
            <span
              v-if="openSummary(project)"
              :class="['app-sidebar__open', `app-sidebar__open--${openSummary(project)!.tone}`]"
              aria-hidden="true"
              >{{ openSummary(project)!.count }}</span
            >
          </span>
        </AppTooltip>
      </template>
      <p v-if="projectsStore.failed" class="app-sidebar__note">{{ t('projects.loadFailed') }}</p>
    </div>

    <span class="app-sidebar__spacer" />

    <UserMenu />
  </nav>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 6px 6px 10px;
}

.app-sidebar__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-right: 4px;
}

.app-sidebar__toggle {
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

.app-sidebar__toggle:hover {
  color: var(--ink);
}

.app-sidebar__toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.app-sidebar--collapsed .app-sidebar__top {
  justify-content: center;
  padding-right: 0;
}

.app-sidebar--collapsed .app-sidebar__link {
  justify-content: center;
  padding: 0;
}

.app-sidebar--collapsed :deep(.org-switcher),
.app-sidebar--collapsed :deep(.user-menu) {
  justify-content: center;
  width: 100%;
  margin: 0;
  padding: 0;
}

.app-sidebar--collapsed :deep(.org-switcher__name),
.app-sidebar--collapsed :deep(.user-menu__name) {
  display: none;
}

.app-sidebar__brand {
  padding: 0 10px;
  font-size: 15px;
}

.app-sidebar__group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.app-sidebar__heading {
  padding: 0 10px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-3);
}

.app-sidebar__link {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--ink-2);
  text-decoration: none;
}

.app-sidebar__link:hover {
  color: var(--ink);
}

.app-sidebar__project {
  min-height: 38px;
}

.app-sidebar__search {
  width: 100%;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.app-sidebar__search:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.app-sidebar__kbd {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-chip);
  font-family: var(--font-sans);
  font-size: 11px;
  color: var(--ink-3);
}

@media (max-width: 767px) {
  .app-sidebar__kbd {
    display: none;
  }
}

.app-sidebar__project--disabled {
  opacity: 0.6;
}

.app-sidebar__link[aria-current='page'] {
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--border);
  color: var(--ink);
  font-weight: 600;
}

.app-sidebar__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-sidebar__open {
  flex: none;
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  text-align: center;
}

.app-sidebar--collapsed .app-sidebar__project {
  position: relative;
}

.app-sidebar--collapsed .app-sidebar__open {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  padding: 0 4px;
  font-size: 10px;
}
.app-sidebar__open--debug {
  background: var(--level-debug-bg);
  color: var(--level-debug-fg);
}

.app-sidebar__open--info {
  background: var(--level-info-bg);
  color: var(--level-info-fg);
}

.app-sidebar__open--notice {
  background: var(--level-notice-bg);
  color: var(--level-notice-fg);
}

.app-sidebar__open--warning {
  background: var(--level-warning-bg);
  color: var(--level-warning-fg);
}

.app-sidebar__open--error {
  background: var(--level-error-bg);
  color: var(--level-error-fg);
}

.app-sidebar__open--critical {
  background: var(--level-critical-bg);
  color: var(--level-critical-fg);
}

.app-sidebar__open--alert {
  background: var(--level-alert-bg);
  color: var(--level-alert-fg);
}

.app-sidebar__open--emergency {
  background: var(--level-emergency-bg);
  color: var(--level-emergency-fg);
}

.app-sidebar__note {
  margin: 0;
  padding: 0 10px;
  font-size: 12px;
  color: var(--ink-3);
}

.app-sidebar__spacer {
  flex: 1;
}
</style>
