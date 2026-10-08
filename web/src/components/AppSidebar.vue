<script setup lang="ts">
import { House } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'
import OrgSwitcher from './OrgSwitcher.vue'
import UserMenu from './UserMenu.vue'
import ProjectKey from './ui/ProjectKey.vue'

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

function currentFor(projectId: number): 'page' | undefined {
  return activeProjectId.value === projectId ? 'page' : undefined
}
</script>

<template>
  <nav class="app-sidebar" :aria-label="t('sidebar.label')">
    <strong class="app-sidebar__brand">{{ t('app.name') }}</strong>

    <OrgSwitcher />

    <div class="app-sidebar__group">
      <RouterLink :to="{ name: 'projects' }" class="app-sidebar__link">
        <House :size="17" aria-hidden="true" />
        <span>{{ t('sidebar.home') }}</span>
      </RouterLink>
    </div>

    <div v-if="organization.activeId !== null" class="app-sidebar__group">
      <span class="app-sidebar__heading">{{ t('projects.title') }}</span>
      <template v-for="project in projectsStore.projects" :key="project.id">
        <RouterLink
          v-if="projectsStore.channelByProject[project.id] !== undefined"
          :to="{ name: 'channel', params: { id: projectsStore.channelByProject[project.id] } }"
          class="app-sidebar__link app-sidebar__project"
          :aria-current="currentFor(project.id)"
        >
          <ProjectKey :value="project.key" />
          <span class="app-sidebar__name">{{ project.name }}</span>
        </RouterLink>
        <span
          v-else
          class="app-sidebar__link app-sidebar__project app-sidebar__project--disabled"
          :aria-current="currentFor(project.id)"
        >
          <ProjectKey :value="project.key" />
          <span class="app-sidebar__name">{{ project.name }}</span>
        </span>
      </template>
      <p v-if="projectsStore.failed" class="app-sidebar__note" role="alert">{{ t('projects.loadFailed') }}</p>
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
