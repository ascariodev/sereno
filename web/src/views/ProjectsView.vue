<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useProjectsStore } from '../stores/projects'

const { t } = useI18n()
const store = useProjectsStore()
const { projects, channelByProject, loading, failed } = storeToRefs(store)
const reload = store.reload
</script>

<template>
  <section class="projects">
    <h1>{{ t('projects.title') }}</h1>
    <p v-if="loading">{{ t('common.loading') }}</p>
    <p v-else-if="failed" role="alert">
      {{ t('projects.loadFailed') }}
      <button type="button" name="retry" @click="reload">{{ t('common.retry') }}</button>
    </p>
    <p v-else-if="projects.length === 0" class="projects__empty">{{ t('projects.empty') }}</p>
    <ul v-else class="projects__list">
      <li v-for="project in projects" :key="project.id" class="projects__item">
        <RouterLink
          v-if="channelByProject[project.id]"
          :to="{ name: 'channel', params: { id: channelByProject[project.id] } }"
        >
          {{ project.name }}
        </RouterLink>
        <span v-else>{{ project.name }}</span>
        <small class="projects__key">{{ project.key }}</small>
        <p v-if="project.description" class="projects__description">{{ project.description }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.projects__list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.projects__key {
  margin-left: 0.5rem;
  opacity: 0.6;
}

.projects__description {
  margin: 0.25rem 0 0;
  opacity: 0.8;
}
</style>
