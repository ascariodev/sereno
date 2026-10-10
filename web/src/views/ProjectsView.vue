<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ProjectCard from '../components/ProjectCard.vue'
import { useOpenProjectCreate } from '../composables/useProjectCreate'
import { useAuthStore } from '../stores/auth'
import { useOrganizationStore } from '../stores/organization'
import { useProjectsStore } from '../stores/projects'

const { t } = useI18n()
const store = useProjectsStore()
const { projects, channelByProject, loading, failed } = storeToRefs(store)
const reload = store.reload
const organization = useOrganizationStore()
const openProjectCreate = useOpenProjectCreate()
const { user } = storeToRefs(useAuthStore())
const greeting = computed(() => (user.value ? t('projects.greeting', { name: user.value.name }) : t('projects.title')))
</script>

<template>
  <section class="projects">
    <h1 class="projects__greeting">{{ greeting }}</h1>
    <div class="projects__bar">
      <h2 class="projects__heading">{{ t('projects.title') }}</h2>
      <button
        v-if="organization.canCreateProject"
        type="button"
        name="create-project"
        class="projects__create"
        aria-haspopup="dialog"
        @click="openProjectCreate"
      >
        {{ t('projects.create') }}
      </button>
    </div>
    <p v-if="loading && projects.length === 0">{{ t('common.loading') }}</p>
    <p v-else-if="failed" role="alert">
      {{ t('projects.loadFailed') }}
      <button type="button" name="retry" @click="reload">{{ t('common.retry') }}</button>
    </p>
    <div v-else-if="projects.length === 0" class="projects__empty">
      <strong>{{ t('projects.empty') }}</strong>
      <span>{{ t('projects.emptyHint') }}</span>
      <button
        v-if="organization.canCreateProject"
        type="button"
        name="create-project-empty"
        class="projects__create"
        aria-haspopup="dialog"
        @click="openProjectCreate"
      >
        {{ t('projects.create') }}
      </button>
    </div>
    <ul v-else class="projects__list">
      <li v-for="project in projects" :key="project.id">
        <ProjectCard :project="project" :channel-id="channelByProject[project.id]" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.projects {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 1040px;
  margin: 0 auto;
  padding: 44px 32px 40px;
}

.projects__greeting {
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.projects__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.projects__create {
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

.projects__create:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.projects__empty .projects__create {
  margin-top: var(--space-2);
}

.projects__heading {
  margin: 0;
  color: var(--ink-2);
  font-size: 14px;
  font-weight: 600;
}

.projects p {
  margin: 0;
}

.projects__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(290px, 100%), 1fr));
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.projects__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 40px 16px;
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-panel);
  color: var(--ink-3);
  text-align: center;
}

.projects__empty strong {
  color: var(--ink-2);
}

@media (max-width: 600px) {
  .projects {
    padding: 24px 16px;
  }
}
</style>
