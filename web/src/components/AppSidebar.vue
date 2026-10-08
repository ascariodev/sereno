<script setup lang="ts">
import { House, LogOut } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'
import AppAvatar from './ui/AppAvatar.vue'
import ProjectKey from './ui/ProjectKey.vue'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const organization = useOrganizationStore()
const projectsStore = useProjectsStore()


async function logout(): Promise<void> {
  await auth.logout()
  await router.push({ name: 'login' })
}

function onSelect(event: Event): void {
  organization.select(Number((event.target as HTMLSelectElement).value))
}
</script>

<template>
  <nav class="app-sidebar" :aria-label="t('sidebar.label')">
    <strong class="app-sidebar__brand">{{ t('app.name') }}</strong>

    <label v-if="organization.organizations.length > 0" class="app-sidebar__org">
      <span>{{ t('organization.label') }}</span>
      <select name="organization" :value="organization.activeId ?? ''" @change="onSelect">
        <option v-for="item in organization.organizations" :key="item.id" :value="item.id">
          {{ item.name }}
        </option>
      </select>
    </label>

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
        >
          <ProjectKey :value="project.key" />
          <span class="app-sidebar__name">{{ project.name }}</span>
        </RouterLink>
        <span v-else class="app-sidebar__link app-sidebar__project app-sidebar__project--disabled">
          <ProjectKey :value="project.key" />
          <span class="app-sidebar__name">{{ project.name }}</span>
        </span>
      </template>
      <p v-if="projectsStore.failed" class="app-sidebar__note" role="alert">{{ t('projects.loadFailed') }}</p>
    </div>

    <span class="app-sidebar__spacer" />

    <div v-if="auth.user" class="app-sidebar__user">
      <AppAvatar :name="auth.user.name" :id="auth.user.id" />
      <span class="app-sidebar__name">{{ auth.user.name }}</span>
      <button type="button" name="logout" class="app-sidebar__logout" @click="logout">
        <LogOut :size="16" aria-hidden="true" />
        <span>{{ t('layout.logout') }}</span>
      </button>
    </div>
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

.app-sidebar__org {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: 0 4px;
  font-size: 12px;
  color: var(--ink-3);
}

.app-sidebar__org select {
  min-height: 40px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--ink);
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

.app-sidebar__user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  font-weight: 600;
}

.app-sidebar__logout {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-3);
  font-weight: 400;
  cursor: pointer;
}

.app-sidebar__logout:hover {
  color: var(--ink);
}
</style>
