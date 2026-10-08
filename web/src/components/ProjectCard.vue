<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { Project } from '../api/types'
import ProjectKey from './ui/ProjectKey.vue'

defineProps<{ project: Pick<Project, 'id' | 'name' | 'key' | 'description'>; channelId?: number }>()
</script>

<template>
  <component
    :is="channelId ? RouterLink : 'div'"
    :to="channelId ? { name: 'channel', params: { id: channelId } } : undefined"
    class="project-card"
    :class="{ 'project-card--link': channelId }"
    :aria-labelledby="channelId ? `project-${project.id}-name` : undefined"
    :aria-describedby="channelId && project.description ? `project-${project.id}-description` : undefined"
  >
    <span class="project-card__head">
      <ProjectKey :value="project.key" />
      <span :id="`project-${project.id}-name`" class="project-card__name" :title="project.name">{{ project.name }}</span>
    </span>
    <span v-if="project.description" :id="`project-${project.id}-description`" class="project-card__description">{{ project.description }}</span>
  </component>
</template>

<style scoped>
.project-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 112px;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  background: var(--surface);
  color: var(--ink);
  text-decoration: none;
}

.project-card--link:hover {
  border-color: var(--accent);
}

.project-card--link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.project-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.project-card__name {
  min-width: 0;
  overflow: hidden;
  font-size: 16px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-card__description {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  color: var(--ink-2);
  font-size: 13.5px;
}
</style>
